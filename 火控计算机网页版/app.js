// ==================== 全局状态 ====================
const LETTERS = "ABCDEFGHIJKLMNOPQRST".split("");
const ELEVATION_CONFIG = { 1:{factor:12.0,max:5}, 2:{factor:6.0,max:10}, 3:{factor:4.0,max:15}, 4:{factor:3.0,max:20}, 5:{factor:2.4,max:25}, 6:{factor:2.0,max:30} };

const state = {
    currentAmmo: 'STAR',
    cannonPos: null,
    history: [],
    mapAutoFire: false,
    mapMaxCharge: false,
    queueAutoStrike: false,
    completed: [],
    pinned: [],
    numMap: {},
    _nextNum: 1,
    queueState: null,
    _autoStrikeInProgress: false,
    points: {
        spotter: [],
        ref: [],
        target: []
    },
    enemies: [],
    map: {
        scale: 1,
        offsetX: 0,
        offsetY: 0,
        isDragging: false,
        lastX: 0,
        lastY: 0
    },
    recon: {
        isMode: false,
        step: 0,
        pivot: null,
        angle: 0,
        mouseX: 0,
        mouseY: 0
    }
};

// ==================== 敌人翻译表 ====================

const ENEMY_NAME_TRANSLATIONS = {
    'FDC': '火控指挥站#',
    'FireControlDirector': '火控指挥站',
    'Enemy Fire Direction Center': '火控指挥站',
    'HostileArtillery': '敌方野战炮兵',
    'Enemy Field Artillery': '敌方野战炮兵',
    'HostileTank': '敌方装甲部队',
    'Enemy Armor Mechanized': '敌方装甲部队',
    'AmmoCache': '弹药库',
    'Enemy Ammunition Cache': '敌方弹药补给',
    'SupplyCache': '补给仓库',
    'HostileInfantry': '敌方步兵',
    'HostileInfatry': '敌方步兵',
    'Enemy Infantry': '敌方步兵',
};

function translateEnemyName(displayName) {
    if (!displayName) return '未知';
    for (const [en, cn] of Object.entries(ENEMY_NAME_TRANSLATIONS)) {
        if (displayName.startsWith(en)) {
            const suffix = displayName.slice(en.length);
            if (cn.endsWith('#') && (suffix === '' || !suffix.startsWith('#'))) {
                return cn.slice(0, -1);
            }
            return cn + suffix;
        }
    }
    return displayName;
}

const ENEMY_SORT_PRIORITY = {
    '火控指挥站': 0,
    '敌方野战炮兵': 1,
};

function getEnemySortKey(name) {
    for (const [prefix, priority] of Object.entries(ENEMY_SORT_PRIORITY)) {
        if (name.startsWith(prefix)) return priority;
    }
    return 99;
}

// ==================== 敌人数据获取 ====================

let enemyPollInterval = null;
let queuePollInterval = null;

async function fetchEnemyData() {
    try {
        const response = await fetch('/api/enemies', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) return;
        
        const data = await response.json();
        if (data.enemies && Array.isArray(data.enemies)) {
            state.enemies = data.enemies.map(e => ({
                name: e.name || '未知',
                displayName: translateEnemyName(e.displayName || e.name || '未知'),
                x: e.x,
                y: e.y
            }));
            
            drawRadarMap();
            renderMapPointsList();
            
            // 如果自动添加敌人到目标列表开启，则更新
            if (state.autoAddEnemies) {
                state.enemies.forEach(enemy => {
                    const existing = state.points.target.findIndex(p => p.name === enemy.name);
                    if (existing < 0 && enemy.x !== undefined && enemy.y !== undefined) {
                        state.points.target.push({
                            name: enemy.name,
                            coord: { x: enemy.x, y: enemy.y },
                            type: 'target'
                        });
                    }
                });
            }

            ensureAutoStrikeQueue();
        }
    } catch (e) {
        // 忽略连接错误（服务器可能未启动）
    }
}

function startEnemyPolling() {
    if (enemyPollInterval) return;
    enemyPollInterval = setInterval(fetchEnemyData, 2000);
    fetchEnemyData();
}

function stopEnemyPolling() {
    if (enemyPollInterval) {
        clearInterval(enemyPollInterval);
        enemyPollInterval = null;
    }
}

function startQueuePolling() {
    if (queuePollInterval) return;
    queuePollInterval = setInterval(() => {
        const toggle = document.getElementById('queue-auto-refresh');
        if (!toggle || toggle.checked) {
            refreshQueue();
        }
    }, 2000);
    refreshQueue();
}

function stopQueuePolling() {
    if (queuePollInterval) {
        clearInterval(queuePollInterval);
        queuePollInterval = null;
    }
}

// ==================== 坐标系统工具函数 ====================

function parseCoord(str) {
    if (!str || typeof str !== 'string') return null;
    str = str.trim();
    
    const namePrefixMatch = str.match(/^[\u4e00-\u9fff\w#]+\s*[-–—]\s*/);
    if (namePrefixMatch) {
        str = str.slice(namePrefixMatch[0].length).trim();
    }
    
    let letter, mainNum, m, n;
    
    const colonMatch = str.match(/^([A-Za-z])\s*(\d+)\s+\[?(\d+):(\d+)\]?$/);
    if (colonMatch) {
        letter = colonMatch[1].toUpperCase();
        mainNum = parseInt(colonMatch[2]);
        m = parseInt(colonMatch[3]);
        n = parseInt(colonMatch[4]);
    } else {
        const compactMatch = str.match(/^([A-Za-z])(\d+)(\d)(\d)$/);
        if (compactMatch) {
            letter = compactMatch[1].toUpperCase();
            mainNum = parseInt(compactMatch[2]);
            m = parseInt(compactMatch[3]);
            n = parseInt(compactMatch[4]);
        } else {
            const simpleMatch = str.match(/^([A-Za-z])(\d+)$/);
            if (simpleMatch) {
                letter = simpleMatch[1].toUpperCase();
                mainNum = parseInt(simpleMatch[2]);
                m = 5;
                n = 5;
            } else {
                return null;
            }
        }
    }
    
    const ix = LETTERS.indexOf(letter);
    if (ix < 0) return null;
    
    const x = ix + m / 10 + 0.05;
    const y = mainNum - 1 + n / 10 + 0.05;
    
    return { x, y, letter, mainNum, m, n, raw: str };
}

function coordToDisplay(x, y) {
    if (x < 0 || y < 0 || x >= 20 || y >= 10) return "区域外";
    const lx = Math.max(0, Math.min(19.999, x));
    const ly = Math.max(0, Math.min(9.999, y));
    const ix = Math.floor(lx);
    const iy = Math.floor(ly);
    const sx = Math.floor((lx - ix) * 10);
    const sy = Math.floor((ly - iy) * 10);
    return `${LETTERS[ix]}${iy + 1} ${sx}:${sy}`;
}

function coordToCompact(x, y) {
    if (x < 0 || y < 0 || x >= 20 || y >= 10) return "区域外";
    const lx = Math.max(0, Math.min(19.999, x));
    const ly = Math.max(0, Math.min(9.999, y));
    const ix = Math.floor(lx);
    const iy = Math.floor(ly);
    const sx = Math.floor((lx - ix) * 10);
    const sy = Math.floor((ly - iy) * 10);
    return `${LETTERS[ix]}${iy + 1}${sx}${sy}`;
}

// ==================== 射击计算 ====================

function calcDistance(pos1, pos2) {
    const dx = pos2.x - pos1.x;
    const dy = pos2.y - pos1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

function calcElevation(distance) {
    let charge = 1;
    for (let i = 1; i <= 6; i++) {
        if (distance <= ELEVATION_CONFIG[i].max) {
            charge = i;
            break;
        }
    }
    if (distance > 30) charge = 6;
    
    const elevation = distance * ELEVATION_CONFIG[charge].factor;
    
    const chargeNames = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六' };
    
    return { 
        elevation: Math.round(elevation * 100) / 100, 
        charge: chargeNames[charge],
        chargeNum: charge,
        isOverflow: elevation > 60 || distance > 30
    };
}

function calcBearing(fromPos, toPos) {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    
    const angleRad = Math.atan2(dy, dx);
    let bearing = 90 - angleRad * 180 / Math.PI;
    
    if (bearing < 0) bearing += 360;
    if (bearing >= 360) bearing -= 360;
    
    return Math.round(bearing * 10) / 10;
}

// ==================== 三角定位 ====================

function bearingToPoint(fromPos, bearingDeg) {
    const angleRad = (90 - bearingDeg) * Math.PI / 180;
    const dx = Math.cos(angleRad);
    const dy = Math.sin(angleRad);
    return { dx, dy };
}

function lineLineIntersect(p1, d1, p2, d2) {
    const cross = d1.dx * d2.dy - d1.dy * d2.dx;
    if (Math.abs(cross) < 0.0001) return null;
    
    const t = ((p2.x - p1.x) * d2.dy - (p2.y - p1.y) * d2.dx) / cross;
    return {
        x: p1.x + t * d1.dx,
        y: p1.y + t * d1.dy
    };
}

function lineCircleIntersect(linePoint, lineDir, circleCenter, radius) {
    const fx = linePoint.x - circleCenter.x;
    const fy = linePoint.y - circleCenter.y;
    
    const a = lineDir.dx * lineDir.dx + lineDir.dy * lineDir.dy;
    const b = 2 * (fx * lineDir.dx + fy * lineDir.dy);
    const c = fx * fx + fy * fy - radius * radius;
    
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];
    
    const sqrtDisc = Math.sqrt(discriminant);
    const t1 = (-b - sqrtDisc) / (2 * a);
    const t2 = (-b + sqrtDisc) / (2 * a);
    
    const results = [];
    if (t1 >= 0) {
        results.push({
            x: linePoint.x + t1 * lineDir.dx,
            y: linePoint.y + t1 * lineDir.dy
        });
    }
    if (t2 >= 0 && Math.abs(t2 - t1) > 0.001) {
        results.push({
            x: linePoint.x + t2 * lineDir.dx,
            y: linePoint.y + t2 * lineDir.dy
        });
    }
    
    return results;
}

function circleCircleIntersect(c1, r1, c2, r2) {
    const dx = c2.x - c1.x;
    const dy = c2.y - c1.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    
    if (d > r1 + r2 || d < Math.abs(r1 - r2) || d === 0) return [];
    
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
    const h = Math.sqrt(r1 * r1 - a * a);
    
    const midX = c1.x + a * dx / d;
    const midY = c1.y + a * dy / d;
    
    const rx = -dy * h / d;
    const ry = dx * h / d;
    
    return [
        { x: midX + rx, y: midY + ry },
        { x: midX - rx, y: midY - ry }
    ];
}

function triangulateTwoBearings(p1, bearing1, p2, bearing2) {
    const d1 = bearingToPoint(p1, bearing1);
    const d2 = bearingToPoint(p2, bearing2);
    return lineLineIntersect(p1, d1, p2, d2);
}

function triangulateBearingDistance(bearingPoint, bearing, distPoint, distance) {
    const dir = bearingToPoint(bearingPoint, bearing);
    const intersections = lineCircleIntersect(bearingPoint, dir, distPoint, distance);
    return intersections;
}

function triangulateTwoDistances(p1, d1, p2, d2) {
    return circleCircleIntersect(p1, d1, p2, d2);
}

function pointFromBearingDistance(fromPos, bearingDeg, distance) {
    const angleRad = (90 - bearingDeg) * Math.PI / 180;
    return {
        x: fromPos.x + distance * Math.cos(angleRad),
        y: fromPos.y + distance * Math.sin(angleRad)
    };
}

// ==================== 页面导航 ====================

function switchPage(pageName) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById('page-' + pageName).classList.add('active');
    document.querySelector(`.nav-btn[data-page="${pageName}"]`).classList.add('active');
    
    if (pageName === 'scout') {
        updatePointSelects();
    }
    
    if (pageName === 'map') {
        initMap();
        drawRadarMap();
        renderMapPointsList();
        startEnemyPolling();
    } else {
        stopEnemyPolling();
    }

    if (pageName === 'queue') {
        startQueuePolling();
    } else {
        stopQueuePolling();
    }
}

function switchSmallTab(tabName) {
    document.querySelectorAll('.tab-small-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-small-content').forEach(c => c.classList.remove('active'));
    
    document.querySelector(`.tab-small-btn[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById('tab-' + tabName).classList.add('active');
}

// ==================== 射击计算页面逻辑 ====================

function selectAmmo(ammo) {
    state.currentAmmo = ammo;
    document.querySelectorAll('.ammo-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.ammo === ammo);
    });
    saveState();
}

function calculateFiring() {
    const cannonStr = document.getElementById('cannon-pos').value;
    const targetStr = document.getElementById('target-pos').value;
    
    const cannon = parseCoord(cannonStr);
    const target = state._pendingTargetCoord || parseCoord(targetStr);
    
    if (!cannon) {
        alert('铁巢坐标格式错误！请输入如 "C2 3:4" 或 "C234"');
        return;
    }
    if (!target) {
        alert('目标坐标格式错误！请输入如 "N449 7:0" 或 "N44970"');
        return;
    }
    
    state.cannonPos = cannon;
    
    const distance = calcDistance(cannon, target);
    const { elevation, charge } = calcElevation(distance);
    const bearing = calcBearing(cannon, target);
    
    const record = {
        id: Date.now(),
        target: targetStr,
        targetCoord: target,
        targetName: state._pendingTargetName || '',
        distance: Math.round(distance * 100) / 100,
        elevation,
        bearing,
        charge,
        ammo: state.currentAmmo,
        timestamp: Date.now(),
        completed: false
    };
    
    state.history.push(record);
    if (state.history.length > 50) state.history.shift();
    state._pendingTargetName = '';
    state._pendingTargetCoord = null;
    
    updateCannonDisplay();
    renderHistory();
    drawRadarMap();
    saveState();
    
    document.getElementById('target-pos').value = '';
}

function confirmCannonPos() {
    const str = document.getElementById('cannon-pos').value.trim();
    const parsed = parseCoord(str);
    if (parsed) {
        state.cannonPos = { x: parsed.x, y: parsed.y };
        updateCannonDisplay();
        saveState();
    } else {
        alert('坐标格式错误！请输入如 "C2 3:4" 或 "C234"');
    }
}

function updateCannonDisplay() {
    const display = document.getElementById('current-cannon-display');
    if (state.cannonPos) {
        display.textContent = coordToDisplay(state.cannonPos.x, state.cannonPos.y);
    }
}

function renderHistory() {
    const container = document.getElementById('history-list');
    if (state.history.length === 0) {
        container.innerHTML = '<div style="color:#666;text-align:center;padding:20px;">暂无计算记录</div>';
        return;
    }
    
    const pending = state.history.filter(h => !h.completed);
    const completed = state.history.filter(h => h.completed);
    
    const allItems = [...pending, ...completed];
    
    container.innerHTML = allItems.map((item) => {
        const targetDisplay = item.targetCoord ? coordToDisplay(item.targetCoord.x, item.targetCoord.y) : item.target;
        const targetLabel = item.targetName ? `${item.targetName} [${targetDisplay}]` : `[${targetDisplay}]`;
        const pendingIdx = pending.indexOf(item);
        const orderNum = item.completed ? '' : `${pendingIdx + 1}`;
        
        return `
        <div class="history-item ${item.completed ? 'completed' : ''}">
            ${item.completed 
                ? '<div class="h-check">✓</div>' 
                : `<div class="h-order">${orderNum}</div>`}
            <div class="h-ammo" style="color: ${item.completed ? '#6bcb77' : getAmmoColor(item.ammo)}">${item.ammo}</div>
            <div class="h-target">${targetLabel}</div>
            <div class="h-info">${item.distance}KM 发射药数量：${item.charge}</div>
            <div class="h-angles">仰角${item.elevation}° 方位角${item.bearing}°</div>
            <div class="h-actions">
                <button class="h-btn h-complete-btn" onclick="toggleComplete(${item.id})" title="${item.completed ? '取消完成' : '标记完成'}">
                    ${item.completed ? '↩' : '✓'}
                </button>
                <button class="h-btn h-delete-btn" onclick="deleteHistory(${item.id})" title="删除">
                    ✕
                </button>
            </div>
        </div>
        `;
    }).join('');
}

function getAmmoColor(ammo) {
    const colors = {
        'AP': '#ff6b6b',
        'HE': '#ffd93d',
        'HCHE': '#6bcb77',
        'STAR': '#4d96ff'
    };
    return colors[ammo] || '#4d96ff';
}

function deleteHistory(id) {
    state.history = state.history.filter(h => h.id !== id);
    renderHistory();
    saveState();
}

function toggleComplete(id) {
    const item = state.history.find(h => h.id === id);
    if (item) {
        item.completed = !item.completed;
        renderHistory();
        drawRadarMap();
        renderMapPointsList();
        saveState();
    }
}

function clearHistory() {
    if (confirm('确定要清空所有计算记录吗？')) {
        state.history = [];
        state.lastImpactPoint = null;
        renderHistory();
        drawRadarMap();
        saveState();
    }
}

// ==================== 侦察定位页面逻辑 ====================

function addPoint(type) {
    let nameInput, posInput;
    if (type === 'spotter') {
        nameInput = document.getElementById('spotter-name');
        posInput = document.getElementById('spotter-pos');
    } else if (type === 'ref') {
        nameInput = document.getElementById('ref-name');
        posInput = document.getElementById('ref-pos');
    } else {
        nameInput = document.getElementById('target-name-scout');
        posInput = document.getElementById('target-pos-scout');
    }
    
    const name = nameInput.value.trim();
    const posStr = posInput.value.trim();
    
    if (!name) {
        alert('请输入名称');
        return;
    }
    
    let coord = null;
    if (posStr) {
        coord = parseCoord(posStr);
        if (!coord) {
            alert('坐标格式错误！');
            return;
        }
    }
    
    const existing = state.points[type].findIndex(p => p.name === name);
    if (existing >= 0) {
        if (confirm('该名称已存在，是否更新？')) {
            state.points[type][existing] = { name, coord, type };
        } else {
            return;
        }
    } else {
        state.points[type].push({ name, coord, type });
    }
    
    nameInput.value = '';
    posInput.value = '';
    
    renderPointLists();
    updatePointSelects();
    saveState();
    ensureAutoStrikeQueue();
}

function deletePoint(type, name) {
    if (confirm(`确定删除 ${name} 吗？`)) {
        state.points[type] = state.points[type].filter(p => p.name !== name);
        renderPointLists();
        updatePointSelects();
        saveState();
    }
}

function clearAllPoints() {
    if (confirm('确定清空所有点位数据吗？')) {
        state.points = { spotter: [], ref: [], target: [] };
        renderPointLists();
        updatePointSelects();
        saveState();
    }
}

function clearClipboard() {
    document.getElementById('clipboard-input').value = '';
    document.getElementById('parse-result').style.display = 'none';
}

function renderPointLists() {
    renderPointList('spotter', 'spotter-list');
    renderPointList('ref', 'ref-list');
    renderPointList('target', 'target-list');
}

function renderPointList(type, containerId) {
    const container = document.getElementById(containerId);
    const points = state.points[type];
    
    if (points.length === 0) {
        container.innerHTML = '<div style="color:#666;text-align:center;padding:12px;font-size:13px;">暂无数据</div>';
        return;
    }
    
    container.innerHTML = points.map(p => {
        const hasConditions = p.conditions && p.conditions.length > 0;
        let condHtml = '';
        if (hasConditions && !p.coord) {
            condHtml = p.conditions.map(c => {
                const typeName = c.type === 'bearing' ? '方位角' : '距离';
                const unit = c.type === 'bearing' ? '°' : 'km';
                return `<div style="font-size:12px;color:#888;margin-top:2px;">· 从 ${c.from} ${typeName}: ${c.value}${unit}</div>`;
            }).join('');
        }
        
        return `
        <div class="point-item ${type}">
            <div style="flex:1;min-width:0;">
                <div class="p-name">${p.name}</div>
                <div class="p-pos">${p.coord ? coordToDisplay(p.coord.x, p.coord.y) : '未知坐标'}</div>
                ${condHtml}
            </div>
            <div class="p-actions">
                ${p.coord ? `<button class="p-btn" onclick="usePointAsTarget('${type}', '${p.name}')">设为目标</button>` : ''}
                ${!p.coord && hasConditions ? `<button class="p-btn" onclick="computeSinglePoint('${type}', '${p.name}')">计算</button>` : ''}
                <button class="p-btn del" onclick="deletePoint('${type}', '${p.name}')">删除</button>
            </div>
        </div>
    `}).join('');
}

function computeSinglePoint(type, name) {
    const knownBefore = Object.keys(getAllPointsWithCoords()).length;
    const computed = autoComputeAll();
    renderPointLists();
    updatePointSelects();
    saveState();
    
    const point = state.points[type].find(p => p.name === name);
    if (point && point.coord) {
        alert(`计算成功！\n${name} 的坐标是：${coordToDisplay(point.coord.x, point.coord.y)}`);
    } else if (computed > 0) {
        alert(`共计算出 ${computed} 个坐标，但 ${name} 的条件不足，仍无法计算`);
    } else {
        alert('计算失败，请检查：\n1. 参考点的坐标是否已设置\n2. 条件是否足够（至少需要2个已知条件）');
    }
}

function resolvePointForAction(type, name, rawName) {
    let coord = null;
    let displayName = '';

    if (type === 'enemy') {
        const found = state.enemies.find(e => e.name === (rawName || name));
        if (found && found.x !== undefined) {
            coord = { x: found.x, y: found.y };
            displayName = found.displayName || found.name;
        }
    } else {
        const point = state.points[type].find(p => p.name === name);
        if (point && point.coord) {
            coord = point.coord;
            displayName = point.name;
        }
    }

    return coord ? { coord, displayName: displayName || name } : null;
}

function usePointAsTarget(type, name, rawName) {
    const resolved = resolvePointForAction(type, name, rawName);
    if (!resolved) return;

    const { coord, displayName } = resolved;

    // 清理同坐标的旧目标记录（避免重复）
    const oldIdx = state.points.target.findIndex(p => Math.abs(p.coord.x - coord.x) < 0.01 && Math.abs(p.coord.y - coord.y) < 0.01);
    if (oldIdx >= 0) {
        state.points.target.splice(oldIdx, 1);
    }

    // 记下目标名和原始坐标，供计算时使用
    state._pendingTargetName = displayName;
    state._pendingTargetCoord = coord;

    // 直接填入计算器并跳转
    const compact = coordToCompact(coord.x, coord.y);
    document.getElementById('target-pos').value = compact;
    switchPage('calculator');
}

async function strikePoint(type, name, rawName, options = {}) {
    const resolved = resolvePointForAction(type, name, rawName);
    if (!resolved) {
        if (!options.silent) {
            alert('未找到可用于打击的目标坐标');
        }
        return;
    }

    const { coord, displayName } = resolved;
    if (!state.cannonPos) {
        if (!options.silent) {
            alert('请先设置炮位坐标后再执行打击');
        }
        return;
    }

    const autoFireEnabled = !!document.getElementById('map-auto-fire-toggle')?.checked;
    const maxChargeEnabled = !!document.getElementById('map-max-charge-toggle')?.checked;
    state.mapAutoFire = autoFireEnabled;
    state.mapMaxCharge = maxChargeEnabled;
    saveState();

    const params = new URLSearchParams({
        x: coord.x.toFixed(2),
        y: coord.y.toFixed(2),
        cannonX: state.cannonPos.x.toFixed(2),
        cannonY: state.cannonPos.y.toFixed(2),
        ammo: state.currentAmmo || 'STAR',
        autoFire: autoFireEnabled ? '1' : '0',
        maxCharge: maxChargeEnabled ? '1' : '0',
        name: rawName || name || displayName
    });

    try {
        const response = await fetch(`/api/strike?${params.toString()}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        state._pendingTargetName = displayName;
        state._pendingTargetCoord = coord;

        const completedKey = `${coord.x.toFixed(2)},${coord.y.toFixed(2)}`;
        if (!state.completed) state.completed = [];
        if (!state.completed.includes(completedKey)) {
            state.completed.push(completedKey);
        }
        if (!state.pinned) state.pinned = [];
        state.pinned = state.pinned.filter(k => k !== completedKey);
        renderMapPointsList();
        drawRadarMap();
        saveState();
        refreshQueue();

        const distanceText = typeof data.distance === 'number' ? `${data.distance.toFixed(2)}km` : '未知';
        const angleText = typeof data.angle === 'number' ? `${data.angle.toFixed(1)}°` : '未知';
        if (!options.silent) {
            alert(`已下发打击任务：${displayName}\n弹种：${state.currentAmmo}\n距离：${distanceText}\n角度：${angleText}`);
        }
    } catch (err) {
        if (!options.silent) {
            alert(`打击失败：${err.message || err}`);
        } else {
            console.error('自动打击失败', err);
        }
        throw err;
    }
}

function formatQueueTask(task, emptyText) {
    if (!task) {
        return emptyText || '空闲';
    }
    const angleText = typeof task.angle === 'number' ? `${task.angle.toFixed(1)}°` : '--';
    const distanceText = typeof task.distance === 'number' ? `${task.distance.toFixed(2)}km` : '--';
    const ammoText = task.bulletType || '--';
    const progressText = task.progress || '--';
    return `T${task.targetId} ${ammoText} ${progressText}<br>目标: ${angleText}, ${distanceText}`;
}

function renderQueueState(data) {
    const leftEl = document.getElementById('queue-left-task');
    const rightEl = document.getElementById('queue-right-task');
    const pendingEl = document.getElementById('queue-pending-list');
    if (!leftEl || !rightEl || !pendingEl) {
        return;
    }

    leftEl.innerHTML = formatQueueTask(data.leftTask, '空闲');
    rightEl.innerHTML = formatQueueTask(data.rightTask, '空闲');

        state.queueState = data;
        const pending = Array.isArray(data.pending) ? data.pending : [];
    if (pending.length === 0) {
        pendingEl.innerHTML = '<div style="color:#666;text-align:center;padding:20px;">队列为空</div>';
        return;
    }

    pendingEl.innerHTML = pending.map((task, index) => `
        <div class="queue-task-item">
            <div class="queue-task-main">
                <div class="queue-task-title">#${index + 1} T${task.targetId} ${task.bulletType || ''}</div>
                <div class="queue-task-meta">角度 ${Number(task.angle).toFixed(1)}° | 距离 ${Number(task.distance).toFixed(2)}km | ${task.progress || ''}</div>
            </div>
            <div class="queue-task-actions">
                <button class="p-btn" onclick="moveQueueTask(${index}, ${index - 1})" ${index === 0 ? 'disabled' : ''}>上移</button>
                <button class="p-btn" onclick="moveQueueTask(${index}, ${index + 1})" ${index === pending.length - 1 ? 'disabled' : ''}>下移</button>
                <button class="p-btn del" onclick="removeQueueTask(${index})">删除</button>
            </div>
        </div>
    `).join('');
}

function getCoordKey(coord) {
    if (!coord || typeof coord.x !== 'number' || typeof coord.y !== 'number') return '';
    return `${coord.x.toFixed(2)},${coord.y.toFixed(2)}`;
}

function getQueueTaskCoord(task) {
    if (!task || typeof task.x !== 'number' || typeof task.y !== 'number') return null;
    return { x: task.x, y: task.y };
}

function getQueueTargetKeys(queueState = state.queueState) {
    const keys = new Set();
    if (!queueState) return keys;

    const addTask = (task) => {
        const key = getCoordKey(getQueueTaskCoord(task));
        if (key) keys.add(key);
    };

    addTask(queueState.leftTask);
    addTask(queueState.rightTask);
    (Array.isArray(queueState.pending) ? queueState.pending : []).forEach(addTask);

    return keys;
}

function getQueueTargetCount(queueState = state.queueState) {
    if (!queueState) return 0;
    let count = 0;
    if (queueState.leftTask) count++;
    if (queueState.rightTask) count++;
    count += Array.isArray(queueState.pending) ? queueState.pending.length : 0;
    return count;
}

function getAutoStrikeCandidates() {
    const candidates = [];
    const seen = new Set();
    const queueKeys = getQueueTargetKeys();
    const completedKeys = new Set(state.completed || []);

    const addCandidate = (item) => {
        if (!item || !item.coord) return;
        const key = getCoordKey(item.coord);
        if (!key || seen.has(key) || queueKeys.has(key) || completedKeys.has(key)) return;
        seen.add(key);
        candidates.push(item);
    };

    (state.pinned || []).forEach((key) => {
        const target = state.points.target.find(p => p.coord && getCoordKey(p.coord) === key);
        if (target) {
            addCandidate({ type: 'target', name: target.name, coord: target.coord, rawName: target.name });
        }

        const enemy = state.enemies.find(e => getCoordKey({ x: e.x, y: e.y }) === key);
        if (enemy) {
            addCandidate({ type: 'enemy', name: enemy.displayName || enemy.name, coord: { x: enemy.x, y: enemy.y }, rawName: enemy.name });
        }
    });

    state.points.target.forEach(p => {
        if (!p.coord) return;
        addCandidate({ type: 'target', name: p.name, coord: p.coord, rawName: p.name });
    });

    [...state.enemies]
        .filter(e => typeof e.x === 'number' && typeof e.y === 'number')
        .sort((a, b) => getEnemySortKey(a.displayName || a.name) - getEnemySortKey(b.displayName || b.name))
        .forEach(e => {
            addCandidate({ type: 'enemy', name: e.displayName || e.name, coord: { x: e.x, y: e.y }, rawName: e.name });
        });

    return candidates;
}

async function ensureAutoStrikeQueue() {
    if (!state.queueAutoStrike || state._autoStrikeInProgress || !state.cannonPos || !state.queueState) {
        return;
    }

    const currentCount = getQueueTargetCount();
    if (currentCount >= 4) {
        return;
    }

    const candidates = getAutoStrikeCandidates();
    const needCount = 4 - currentCount;
    if (needCount <= 0 || candidates.length === 0) {
        return;
    }

    state._autoStrikeInProgress = true;
    try {
        for (const candidate of candidates.slice(0, needCount)) {
            await strikePoint(candidate.type, candidate.name, candidate.rawName, { silent: true });
        }
    } catch (err) {
        console.error('自动补充打击队列失败', err);
    } finally {
        state._autoStrikeInProgress = false;
    }
}

async function refreshQueue() {
    try {
        const response = await fetch('/api/queue', {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        renderQueueState(data);
        await ensureAutoStrikeQueue();
    } catch (err) {
        const pendingEl = document.getElementById('queue-pending-list');
        if (pendingEl) {
            pendingEl.innerHTML = `<div style="color:#ff6b6b;text-align:center;padding:20px;">${err.message || err}</div>`;
        }
    }
}

async function removeQueueTask(index) {
    try {
        const task = state.queueState?.pending?.[index] || null;
        const response = await fetch(`/api/queue/remove?index=${index}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        if (task && typeof task.x === 'number' && typeof task.y === 'number') {
            const completedKey = `${task.x.toFixed(2)},${task.y.toFixed(2)}`;
            if (Array.isArray(state.completed)) {
                state.completed = state.completed.filter(k => k !== completedKey);
            }
            renderMapPointsList();
            drawRadarMap();
            saveState();
        }

        refreshQueue();
    } catch (err) {
        alert(`删除失败：${err.message || err}`);
    }
}

async function moveQueueTask(index, to) {
    try {
        const response = await fetch(`/api/queue/move?index=${index}&to=${to}`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || `HTTP ${response.status}`);
        }
        refreshQueue();
    } catch (err) {
        alert(`移动失败：${err.message || err}`);
    }
}

function updateQueueAutoStrikeVisualState() {
    const enabled = !!document.getElementById('queue-auto-strike')?.checked;
    document.body.classList.toggle('queue-auto-strike-active', enabled);
}

function updatePointSelects() {
    const allPoints = [];
    state.points.spotter.forEach(p => { if (p.coord) allPoints.push({ label: `[侦察] ${p.name}`, value: `spotter:${p.name}` }); });
    state.points.ref.forEach(p => { if (p.coord) allPoints.push({ label: `[参考] ${p.name}`, value: `ref:${p.name}` }); });
    state.points.target.forEach(p => { if (p.coord) allPoints.push({ label: `[敌方] ${p.name}`, value: `target:${p.name}` }); });
    if (state.cannonPos) allPoints.push({ label: '[炮位] 铁巢', value: 'cannon' });
    
    const optionsHTML = allPoints.map(p => `<option value="${p.value}">${p.label}</option>`).join('');
    
    document.getElementById('cond1-from').innerHTML = optionsHTML;
    document.getElementById('cond2-from').innerHTML = optionsHTML;
    document.getElementById('quick-from').innerHTML = optionsHTML;
}

function getPointFromSelectValue(value) {
    if (value === 'cannon') return state.cannonPos;
    
    const [type, name] = value.split(':');
    const point = state.points[type]?.find(p => p.name === name);
    return point ? point.coord : null;
}

function triangulate() {
    const targetType = document.getElementById('calc-target-type').value;
    const targetName = document.getElementById('calc-target-name').value.trim();
    
    if (!targetName) {
        alert('请输入计算对象名称');
        return;
    }
    
    const cond1Type = document.getElementById('cond1-type').value;
    const cond1FromVal = document.getElementById('cond1-from').value;
    const cond1Value = parseFloat(document.getElementById('cond1-value').value);
    
    const cond2Type = document.getElementById('cond2-type').value;
    const cond2FromVal = document.getElementById('cond2-from').value;
    const cond2Value = parseFloat(document.getElementById('cond2-value').value);
    
    const point1 = getPointFromSelectValue(cond1FromVal);
    const point2 = getPointFromSelectValue(cond2FromVal);
    
    if (!point1 || !point2) {
        alert('请选择有效的基准点');
        return;
    }
    
    if (isNaN(cond1Value) || isNaN(cond2Value)) {
        alert('请输入有效的数值');
        return;
    }
    
    let results = [];
    
    if (cond1Type === 'bearing' && cond2Type === 'bearing') {
        const result = triangulateTwoBearings(point1, cond1Value, point2, cond2Value);
        if (result) results = [result];
    } else if (cond1Type === 'bearing' && cond2Type === 'distance') {
        results = triangulateBearingDistance(point1, cond1Value, point2, cond2Value);
    } else if (cond1Type === 'distance' && cond2Type === 'bearing') {
        results = triangulateBearingDistance(point2, cond2Value, point1, cond1Value);
    } else {
        results = triangulateTwoDistances(point1, cond1Value, point2, cond2Value);
    }
    
    const resultBox = document.getElementById('triangulate-result');
    const resultCoord = document.getElementById('result-coord');
    
    if (results.length === 0) {
        resultCoord.textContent = '无法计算（无交点）';
        resultBox.style.display = 'block';
        return;
    }
    
    let resultText = '';
    results.forEach((r, i) => {
        const display = coordToDisplay(r.x, r.y);
        const compact = coordToCompact(r.x, r.y);
        resultText += (i > 0 ? '<br>' : '') + `解${i+1}: ${display} (${compact})`;
    });
    
    if (results.length === 1) {
        const existing = state.points[targetType].findIndex(p => p.name === targetName);
        const coord = { x: results[0].x, y: results[0].y };
        
        if (existing >= 0) {
            state.points[targetType][existing].coord = coord;
        } else {
            state.points[targetType].push({ name: targetName, coord, type: targetType });
        }
        
        renderPointLists();
        updatePointSelects();
        saveState();
        
        resultText += '<br><span style="font-size:13px;color:#6bcb77;">已自动保存</span>';
    }
    
    resultCoord.innerHTML = resultText;
    resultBox.style.display = 'block';
}

function quickLocate() {
    const fromVal = document.getElementById('quick-from').value;
    const bearing = parseFloat(document.getElementById('quick-bearing').value);
    const distance = parseFloat(document.getElementById('quick-distance').value);
    
    const fromPoint = getPointFromSelectValue(fromVal);
    
    if (!fromPoint) {
        alert('请选择有效的基准点');
        return;
    }
    
    if (isNaN(bearing) || isNaN(distance)) {
        alert('请输入有效的方位角和距离');
        return;
    }
    
    const result = pointFromBearingDistance(fromPoint, bearing, distance);
    const display = coordToDisplay(result.x, result.y);
    const compact = coordToCompact(result.x, result.y);
    
    document.getElementById('quick-result-coord').innerHTML = `${display}<br>(${compact})`;
    document.getElementById('quick-result').style.display = 'block';
}

function updateCondInputs() {
}

// ==================== 数据持久化 ====================

function saveState() {
    try {
        const data = {
            currentAmmo: state.currentAmmo,
            cannonPos: state.cannonPos,
            history: state.history,
            points: state.points,
            mapAutoFire: state.mapAutoFire,
            mapMaxCharge: state.mapMaxCharge,
            queueAutoStrike: state.queueAutoStrike,
            completed: state.completed,
            pinned: state.pinned,
            numMap: state.numMap,
            _nextNum: state._nextNum
        };
        localStorage.setItem('tiechao_calc_state', JSON.stringify(data));
    } catch (e) {
        console.error('保存失败', e);
    }
}

function loadState() {
    try {
        const data = localStorage.getItem('tiechao_calc_state');
        if (data) {
            const parsed = JSON.parse(data);
            state.currentAmmo = parsed.currentAmmo || 'STAR';
            state.cannonPos = parsed.cannonPos || null;
            state.history = parsed.history || [];
            state.points = parsed.points || { spotter: [], ref: [], target: [] };
            state.mapAutoFire = parsed.mapAutoFire || false;
            state.mapMaxCharge = parsed.mapMaxCharge || false;
            state.queueAutoStrike = parsed.queueAutoStrike || false;
            state.completed = parsed.completed || [];
            state.pinned = parsed.pinned || [];
            state.numMap = parsed.numMap || {};
            state._nextNum = parsed._nextNum || 1;
            
            selectAmmo(state.currentAmmo);
            
            if (state.cannonPos) {
                document.getElementById('cannon-pos').value = coordToDisplay(state.cannonPos.x, state.cannonPos.y);
            }
            
            const mapAutoFireToggle = document.getElementById('map-auto-fire-toggle');
            if (mapAutoFireToggle) mapAutoFireToggle.checked = !!state.mapAutoFire;
            const mapMaxChargeToggle = document.getElementById('map-max-charge-toggle');
            if (mapMaxChargeToggle) mapMaxChargeToggle.checked = !!state.mapMaxCharge;
            const queueAutoStrikeToggle = document.getElementById('queue-auto-strike');
            if (queueAutoStrikeToggle) queueAutoStrikeToggle.checked = !!state.queueAutoStrike;
            updateQueueAutoStrikeVisualState();
            
            updateCannonDisplay();
            renderHistory();
            renderPointLists();
            refreshQueue();
        }
    } catch (e) {
        console.error('加载失败', e);
    }
}

// ==================== 剪贴板解析 ====================

function parseClipboardText(text) {
    const results = [];
    const blocks = text.split(/^\s*[\.\-]+\s*$/m).filter(b => b.trim());
    
    let currentBlock = [];
    const lines = text.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const line = rawLine.replace(/<[^>]+>/g, '').trim();
        
        if (!line) continue;
        
        const isBlockStart = /^参考点\s+/.test(line) 
            || /^Target/i.test(line) 
            || /^AmmoCache/i.test(line) 
            || /^FDC/i.test(line) 
            || /^Spotter/i.test(line)
            || /^Artillery/i.test(line)
            || /^Howitzer/i.test(line)
            || /^Mortar/i.test(line)
            || /^MG|MachineGun/i.test(line)
            || /^Infantry/i.test(line)
            || /^Alpha|Bravo|Charlie|Delta|Echo|Foxtrot|Golf|Hotel/i.test(line)
            || /^<b>/i.test(rawLine.trim())
            || /^[A-Za-z]+#?\d*[：:]/.test(line);
        
        if (isBlockStart) {
            if (currentBlock.length > 0) {
                results.push(parseDataBlock(currentBlock));
            }
            currentBlock = [line];
        } else if (line === '.' || line === '·') {
            if (currentBlock.length > 0) {
                results.push(parseDataBlock(currentBlock));
                currentBlock = [];
            }
        } else if (currentBlock.length > 0) {
            currentBlock.push(line);
        } else {
            const hasNameCoord = line.match(/^(.+?)\s*[-–—]\s*([A-Za-z]+\d+\s*\d*:?\d*)/);
            if (hasNameCoord) {
                currentBlock = [line];
            } else if (/^(从|距)\s/.test(line)) {
                currentBlock = [line];
            }
        }
    }
    
    if (currentBlock.length > 0) {
        results.push(parseDataBlock(currentBlock));
    }
    
    return results;
}

function parseDataBlock(lines) {
    const result = {
        name: '',
        type: 'unknown',
        conditions: [],
        coord: null
    };
    
    const firstLine = lines[0];
    
    const nameCoordMatch = firstLine.match(/^(.+?)\s*[-–—]\s*([A-Za-z]+\d+\s*\d*:?\d*)/);
    if (nameCoordMatch) {
        result.name = nameCoordMatch[1].trim();
        const coord = parseCoord(nameCoordMatch[2].trim());
        if (coord) {
            result.coord = coord;
        }
        result.type = detectTypeByName(result.name);
    }
    
    const refMatch = firstLine.match(/^参考点\s+(.+?)[：:]/);
    if (refMatch) {
        result.name = refMatch[1].trim();
        result.type = 'ref';
    }
    
    const targetMatch = firstLine.match(/^(Target#?\d+).*位于/i);
    if (targetMatch) {
        result.name = targetMatch[1].trim();
        result.type = 'target';
    }
    
    const ammoMatch = firstLine.match(/^(AmmoCache#?\d+)[：:]/i);
    if (ammoMatch) {
        result.name = ammoMatch[1].trim();
        result.type = 'target';
    }
    
    const fdcMatch = firstLine.match(/^(FDC#?\d+)[：:]/i);
    if (fdcMatch) {
        result.name = fdcMatch[1].trim();
        result.type = 'ref';
    }
    
    const spotterMatch = firstLine.match(/^(Spotter#?\d+)[：:]?/i);
    if (spotterMatch) {
        result.name = spotterMatch[1].trim();
        result.type = 'spotter';
    }
    
    const nameColonMatch = firstLine.match(/^([A-Za-z]+#?\d*)(?:\s*[：:])/);
    if (nameColonMatch && !result.name) {
        result.name = nameColonMatch[1].trim();
        result.type = detectTypeByName(result.name);
    }
    
    const nameMatch = firstLine.match(/^[\s\uFEFF\xA0]*([A-Za-z\u4e00-\u9fff]+#?\d*)[\s\uFEFF\xA0]*[：:]/);
    if (nameMatch && !result.name) {
        result.name = nameMatch[1].trim();
        result.type = detectTypeByName(result.name);
    }
    
    if (result.type === 'unknown' && result.name) {
        result.type = detectTypeByName(result.name);
    }
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        const bothMatch = line.match(/从\s*(.+?)\s*方位角\s*(\d+\.?\d*)\s*°?.*?及距离\s*(\d+\.?\d*)\s*km/i);
        if (bothMatch) {
            result.conditions.push({
                type: 'bearing',
                from: bothMatch[1].trim(),
                value: parseFloat(bothMatch[2])
            });
            result.conditions.push({
                type: 'distance',
                from: bothMatch[1].trim(),
                value: parseFloat(bothMatch[3])
            });
            continue;
        }
        
        const bearingMatch = line.match(/从\s*(.+?)\s*方位角\s*(\d+\.?\d*)\s*°?/);
        if (bearingMatch) {
            result.conditions.push({
                type: 'bearing',
                from: bearingMatch[1].trim(),
                value: parseFloat(bearingMatch[2])
            });
        }
        
        const distMatch = line.match(/距\s*(.+?)\s*(\d+\.?\d*)\s*km/i);
        if (distMatch) {
            result.conditions.push({
                type: 'distance',
                from: distMatch[1].trim(),
                value: parseFloat(distMatch[2])
            });
        }
        
        const locatedMatch = line.match(/位于\s*[-–—]\s*([A-Za-z]+\d+\s*\d*:?\d*)/);
        if (locatedMatch) {
            const coord = parseCoord(locatedMatch[1]);
            if (coord) {
                result.coord = coord;
            }
        }
    }
    
    return result;
}

function detectTypeByName(name) {
    const nameLower = name.toLowerCase();
    if (/spotter/i.test(nameLower)) return 'spotter';
    if (/target|ammocache|artillery|howitzer|mortar|mg|machinegun|infantry|敌人|敌方|enemy/i.test(nameLower)) return 'target';
    if (/ref|reference|alpha|bravo|charlie|delta|echo|fdc|参考/i.test(nameLower)) return 'ref';
    return 'unknown';
}

function parseClipboard() {
    const text = document.getElementById('clipboard-input').value;
    if (!text.trim()) {
        alert('请先粘贴数据');
        return;
    }
    
    const parsed = parseClipboardText(text);
    
    const resultBox = document.getElementById('parse-result');
    const resultContent = document.getElementById('parse-result-content');
    
    if (parsed.length === 0) {
        resultContent.innerHTML = '<span style="color:#ff6b6b;">未能识别任何数据</span>';
        resultBox.style.display = 'block';
        return;
    }
    
    let html = '';
    parsed.forEach((item, idx) => {
        const typeNames = { ref: '参考点', target: '敌方目标', spotter: '侦察哨', unknown: '未知类型' };
        const typeColors = { ref: '#6bcb77', target: '#ff6b6b', spotter: '#4d96ff', unknown: '#888' };
        
        html += `<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #333;">`;
        html += `<div style="font-weight:600;color:${typeColors[item.type]};">[${typeNames[item.type]}] ${item.name || '未命名'}</div>`;
        
        if (item.coord) {
            html += `<div style="color:#f0c040;">坐标: ${coordToDisplay(item.coord.x, item.coord.y)}</div>`;
        }
        
        if (item.conditions.length > 0) {
            html += `<div style="color:#aaa;margin-top:4px;">已知条件:</div>`;
            item.conditions.forEach(cond => {
                const condType = cond.type === 'bearing' ? '方位角' : '距离';
                const unit = cond.type === 'bearing' ? '°' : 'km';
                html += `<div style="color:#ccc;">  · 从 ${cond.from} ${condType}: ${cond.value}${unit}</div>`;
            });
        }
        
        html += `</div>`;
    });
    
    html += `<div style="color:#6bcb77;margin-top:8px;">共识别 ${parsed.length} 条数据</div>`;
    
    resultContent.innerHTML = html;
    resultBox.style.display = 'block';
}

function parseAndImport() {
    const text = document.getElementById('clipboard-input').value;
    if (!text.trim()) {
        alert('请先粘贴数据');
        return;
    }
    
    const parsed = parseClipboardText(text);
    let imported = 0;
    
    parsed.forEach(item => {
        if (!item.name || item.type === 'unknown') return;
        if (item.type === 'ref' || item.type === 'target' || item.type === 'spotter') {
            const existing = state.points[item.type].findIndex(p => p.name === item.name);
            if (existing >= 0) {
                if (item.coord) {
                    state.points[item.type][existing].coord = item.coord;
                }
                if (item.conditions && item.conditions.length > 0) {
                    state.points[item.type][existing].conditions = mergeConditions(
                        state.points[item.type][existing].conditions || [],
                        item.conditions
                    );
                }
            } else {
                state.points[item.type].push({
                    name: item.name,
                    coord: item.coord,
                    type: item.type,
                    conditions: item.conditions || []
                });
            }
            imported++;
        }
    });
    
    if (imported > 0) {
        const computed = autoComputeAll();
        renderPointLists();
        updatePointSelects();
        saveState();
        alert(`成功导入 ${imported} 个点！\n自动计算出 ${computed} 个坐标`);
    } else {
        alert('未能导入任何点，请检查数据格式');
    }
    
    parseClipboard();
}

function mergeConditions(oldConds, newConds) {
    const merged = [...oldConds];
    newConds.forEach(nc => {
        const exists = merged.some(oc => oc.type === nc.type && oc.from === nc.from && Math.abs(oc.value - nc.value) < 0.01);
        if (!exists) {
            merged.push(nc);
        }
    });
    return merged;
}

function getAllPointsWithCoords() {
    const all = {};
    ['spotter', 'ref', 'target'].forEach(type => {
        state.points[type].forEach(p => {
            if (p.coord) {
                all[p.name] = { ...p, pointType: type };
            }
        });
    });
    return all;
}

function autoComputeAll() {
    let computedCount = 0;
    let changed = true;
    let iterations = 0;
    const maxIterations = 20;
    
    while (changed && iterations < maxIterations) {
        changed = false;
        iterations++;
        
        const knownPoints = getAllPointsWithCoords();
        
        ['spotter', 'ref', 'target'].forEach(type => {
            state.points[type].forEach(point => {
                if (point.coord) return;
                if (!point.conditions || point.conditions.length < 2) return;
                
                const usableConds = point.conditions.filter(c => knownPoints[c.from]);
                if (usableConds.length < 2) return;
                
                const bearingConds = usableConds.filter(c => c.type === 'bearing');
                const distConds = usableConds.filter(c => c.type === 'distance');
                
                let result = null;
                
                if (bearingConds.length >= 2) {
                    const b1 = bearingConds[0];
                    const b2 = bearingConds[1];
                    const p1 = knownPoints[b1.from].coord;
                    const p2 = knownPoints[b2.from].coord;
                    result = triangulateTwoBearings(p1, b1.value, p2, b2.value);
                } else if (bearingConds.length >= 1 && distConds.length >= 1) {
                    const bc = bearingConds[0];
                    const dc = distConds[0];
                    const bp = knownPoints[bc.from].coord;
                    const dp = knownPoints[dc.from].coord;
                    const intersections = triangulateBearingDistance(bp, bc.value, dp, dc.value);
                    if (intersections && intersections.length > 0) {
                        result = intersections[0];
                    }
                } else if (distConds.length >= 2) {
                    const d1 = distConds[0];
                    const d2 = distConds[1];
                    const p1 = knownPoints[d1.from].coord;
                    const p2 = knownPoints[d2.from].coord;
                    const intersections = triangulateTwoDistances(p1, d1.value, p2, d2.value);
                    if (intersections && intersections.length > 0) {
                        result = intersections[0];
                    }
                }
                
                if (result && result.x && result.y && isFinite(result.x) && isFinite(result.y)) {
                    point.coord = { x: result.x, y: result.y };
                    knownPoints[point.name] = { ...point, pointType: type };
                    changed = true;
                    computedCount++;
                }
            });
        });
    }
    
    return computedCount;
}

// ==================== 战术地图功能 ====================

let mapInitialized = false;
let mapCanvas, mapCtx;
let touchStartDist = 0;
let touchStartScale = 1;
let lastTouchX = 0;
let lastTouchY = 0;
let isPinching = false;

function toggleReconMode() {
    state.recon.isMode = !state.recon.isMode;
    state.recon.step = state.recon.isMode ? 1 : 0;
    if (!state.recon.isMode) {
        state.recon.pivot = null;
        state.recon.angle = 0;
    }
    let btn = document.getElementById('btn-recon-mode');
    if (btn) {
        btn.innerText = state.recon.isMode ? "🛑 取消选点 (按ESC)" : "🗺️ 开启地图选点 (双击模式)";
        btn.style.background = state.recon.isMode ? "#dc2626" : "#0284c7";
    }
    if (mapCanvas) mapCanvas.style.cursor = state.recon.isMode ? "crosshair" : "grab";
    drawRadarMap();
}

function initMap() {
    if (mapInitialized) return;
    
    mapCanvas = document.getElementById('radarCanvas');
    if (!mapCanvas) return;
    
    mapCtx = mapCanvas.getContext('2d');
    mapInitialized = true;
    
    state.map.scale = 1;
    state.map.offsetX = 0;
    state.map.offsetY = 0;
    
    mapCanvas.addEventListener('wheel', handleMapWheel, { passive: false });
    mapCanvas.addEventListener('mousedown', handleMapMouseDown);
    window.addEventListener('mousemove', handleMapMouseMove);
    window.addEventListener('mouseup', handleMapMouseUp);
    mapCanvas.addEventListener('contextmenu', e => e.preventDefault());
    
    mapCanvas.addEventListener('touchstart', handleMapTouchStart, { passive: false });
    mapCanvas.addEventListener('touchmove', handleMapTouchMove, { passive: false });
    mapCanvas.addEventListener('touchend', handleMapTouchEnd);
    
    // 键盘事件：ESC取消侦察机选点模式
    window.addEventListener('keydown', e => {
        if (e.key === 'Escape' && state.recon.isMode) toggleReconMode();
    });

    // 侦察机输入联动
    let reconGrid = document.getElementById('recon-grid');
    let reconAngle = document.getElementById('recon-angle');
    if (reconGrid) reconGrid.addEventListener('input', () => { if (!state.recon.isMode) drawRadarMap(); });
    if (reconAngle) reconAngle.addEventListener('input', () => {
        state.recon.angle = parseFloat(reconAngle.value) || 0;
        if (!state.recon.isMode) drawRadarMap();
    });

    // 按钮事件绑定
    let btnRecon = document.getElementById('btn-recon-mode');
    if (btnRecon) btnRecon.addEventListener('click', toggleReconMode);

    mapCanvas.style.cursor = "grab";
}

function handleMapWheel(e) {
    e.preventDefault();
    const rect = mapCanvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (mapCanvas.width / rect.width);
    const my = (e.clientY - rect.top) * (mapCanvas.height / rect.height);
    
    const zoom = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.5, Math.min(6.0, state.map.scale * zoom));
    const actualZoom = newScale / state.map.scale;
    
    state.map.offsetX = mx - (mx - state.map.offsetX) * actualZoom;
    state.map.offsetY = my - (my - state.map.offsetY) * actualZoom;
    state.map.scale = newScale;
    
    drawRadarMap();
}

function handleMapMouseDown(e) {
    if (state.recon.isMode && e.button === 0) {
        // 侦察机选点模式 - 左键选点
        const rect = mapCanvas.getBoundingClientRect();
        const scaleX = mapCanvas.width / rect.width;
        const scaleY = mapCanvas.height / rect.height;
        let mx = ((e.clientX - rect.left) * scaleX - state.map.offsetX) / state.map.scale / 40;
        let my = 10 - (((e.clientY - rect.top) * scaleY - state.map.offsetY) / state.map.scale / 40);
        
        if (state.recon.step === 1) {
            state.recon.pivot = { x: mx, y: my };
            let gridInput = document.getElementById('recon-grid');
            if (gridInput) gridInput.value = coordToDisplay(mx, my);
            state.recon.step = 2;
            drawRadarMap();
        } else if (state.recon.step === 2) {
            toggleReconMode();
        }
        return;
    }
    if (e.button === 0 || e.button === 2) {
        state.map.isDragging = true;
        state.map.lastX = e.clientX;
        state.map.lastY = e.clientY;
    }
}

function handleMapMouseMove(e) {
    if (!mapCanvas) return;
    const rect = mapCanvas.getBoundingClientRect();
    const scaleX = mapCanvas.width / rect.width;
    const scaleY = mapCanvas.height / rect.height;
    
    // 始终跟踪鼠标在地图上的坐标（用于侦察机角度指示）
    let mx = ((e.clientX - rect.left) * scaleX - state.map.offsetX) / state.map.scale / 40;
    let my = 10 - (((e.clientY - rect.top) * scaleY - state.map.offsetY) / state.map.scale / 40);
    state.recon.mouseX = mx;
    state.recon.mouseY = my;
    
    // 侦察机第二步：鼠标移动实时更新角度
    if (state.recon.isMode && state.recon.step === 2 && state.recon.pivot) {
        let dx = mx - state.recon.pivot.x;
        let dy = my - state.recon.pivot.y;
        let deg = Math.atan2(dx, dy) * 180 / Math.PI;
        if (deg < 0) deg += 360;
        state.recon.angle = deg;
        let angleInput = document.getElementById('recon-angle');
        if (angleInput) angleInput.value = deg.toFixed(1);
        drawRadarMap();
        return;
    }
    
    if (!state.map.isDragging) return;
    
    state.map.offsetX += (e.clientX - state.map.lastX) * scaleX;
    state.map.offsetY += (e.clientY - state.map.lastY) * scaleY;
    state.map.lastX = e.clientX;
    state.map.lastY = e.clientY;
    
    drawRadarMap();
}

function handleMapMouseUp() {
    state.map.isDragging = false;
}

function getTouchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function handleMapTouchStart(e) {
    e.preventDefault();
    
    if (e.touches.length === 2) {
        isPinching = true;
        touchStartDist = getTouchDistance(e.touches);
        touchStartScale = state.map.scale;
        
        const rect = mapCanvas.getBoundingClientRect();
        const mx = ((e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left) * (mapCanvas.width / rect.width);
        const my = ((e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top) * (mapCanvas.height / rect.height);
        state.map.pinchCenterX = mx;
        state.map.pinchCenterY = my;
    } else if (e.touches.length === 1) {
        state.map.isDragging = true;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
    }
}

function handleMapTouchMove(e) {
    e.preventDefault();
    
    if (e.touches.length === 2 && isPinching) {
        const dist = getTouchDistance(e.touches);
        const scale = dist / touchStartDist;
        const newScale = Math.max(0.5, Math.min(6.0, touchStartScale * scale));
        const actualZoom = newScale / state.map.scale;
        
        state.map.offsetX = state.map.pinchCenterX - (state.map.pinchCenterX - state.map.offsetX) * actualZoom;
        state.map.offsetY = state.map.pinchCenterY - (state.map.pinchCenterY - state.map.offsetY) * actualZoom;
        state.map.scale = newScale;
        
        drawRadarMap();
    } else if (e.touches.length === 1 && state.map.isDragging && !isPinching) {
        const rect = mapCanvas.getBoundingClientRect();
        const scaleX = mapCanvas.width / rect.width;
        const scaleY = mapCanvas.height / rect.height;
        
        state.map.offsetX += (e.touches[0].clientX - lastTouchX) * scaleX;
        state.map.offsetY += (e.touches[0].clientY - lastTouchY) * scaleY;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
        
        drawRadarMap();
    }
}

function handleMapTouchEnd(e) {
    if (e.touches.length < 2) {
        isPinching = false;
    }
    if (e.touches.length === 0) {
        state.map.isDragging = false;
    }
}

function coordToCanvas(p) {
    const s = 40;
    return { x: p.x * s, y: 400 - p.y * s };
}

function drawRadarMap() {
    if (!mapCtx) return;
    
    const ctx = mapCtx;
    ctx.save();
    ctx.clearRect(0, 0, 800, 400);
    
    ctx.translate(state.map.offsetX, state.map.offsetY);
    ctx.scale(state.map.scale, state.map.scale);
    
    const s = 40;
    
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 1 / state.map.scale;
    for (let i = 0; i <= 20; i++) {
        ctx.beginPath();
        ctx.moveTo(i * s, 0);
        ctx.lineTo(i * s, 400);
        ctx.stroke();
    }
    for (let j = 0; j <= 10; j++) {
        ctx.beginPath();
        ctx.moveTo(0, j * s);
        ctx.lineTo(800, j * s);
        ctx.stroke();
    }
    
    ctx.fillStyle = "rgba(100, 116, 139, 0.3)";
    ctx.font = `${12 / state.map.scale}px Consolas`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 20; i++) {
        for (let j = 0; j < 10; j++) {
            ctx.fillText(LETTERS[i] + (j + 1), i * s + s / 2, 400 - j * s - s / 2);
        }
    }
    
    if (state.cannonPos) {
        const c = coordToCanvas(state.cannonPos);
        ctx.fillStyle = "#38bdf8";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 5 / state.map.scale, 0, 7);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = `${10 / state.map.scale}px Arial`;
        ctx.fillText("铁巢", c.x, c.y - 10 / state.map.scale);
    }
    
    state.points.spotter.forEach(p => {
        if (!p.coord) return;
        const c = coordToCanvas(p.coord);
        ctx.fillStyle = "#c084fc";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 4 / state.map.scale, 0, 7);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = `${9 / state.map.scale}px Arial`;
        ctx.fillText(p.name, c.x, c.y - 8 / state.map.scale);
    });
    
    state.points.ref.forEach(p => {
        if (!p.coord) return;
        const c = coordToCanvas(p.coord);
        ctx.fillStyle = "#34d399";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 4 / state.map.scale, 0, 7);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = `${9 / state.map.scale}px Arial`;
        ctx.fillText(p.name, c.x, c.y - 8 / state.map.scale);
    });
    
    state.points.target.forEach(p => {
        if (!p.coord) return;
        const c = coordToCanvas(p.coord);
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 4 / state.map.scale, 0, 7);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.font = `${9 / state.map.scale}px Arial`;
        ctx.fillText(p.name, c.x, c.y - 8 / state.map.scale);
    });
    
    // 敌人绘制 - 从游戏mod获取的敌人位置
    if (state.enemies.length > 0) {
        state.enemies.forEach(enemy => {
            if (enemy.x === undefined || enemy.y === undefined) return;
            const c = coordToCanvas({ x: enemy.x, y: enemy.y });
            
            // 敌人用橙色菱形标记
            ctx.fillStyle = "#f97316";
            ctx.beginPath();
            const size = 6 / state.map.scale;
            ctx.moveTo(c.x, c.y - size);
            ctx.lineTo(c.x + size, c.y);
            ctx.lineTo(c.x, c.y + size);
            ctx.lineTo(c.x - size, c.y);
            ctx.closePath();
            ctx.fill();
            
            // 敌人名称
            ctx.fillStyle = "#f97316";
            ctx.font = `${9 / state.map.scale}px Arial`;
            ctx.textAlign = "center";
            ctx.fillText(enemy.displayName || enemy.name, c.x, c.y + 14 / state.map.scale);
        });
    }
    
    // 落点绘制 - 显示所有射击计算记录
    if (state.cannonPos && state.history.length > 0) {
        const cc = coordToCanvas(state.cannonPos);
        
        state.history.forEach((item, idx) => {
            if (!item.targetCoord) return;
            const ic = coordToCanvas(item.targetCoord);
            const color = item.completed ? "#6bcb77" : "#ef4444";
            const orderNum = item.completed ? '' : (idx + 1);
            
            // 炮位到落点的红色实线
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5 / state.map.scale;
            ctx.globalAlpha = item.completed ? 0.5 : 0.8;
            ctx.beginPath();
            ctx.moveTo(cc.x, cc.y);
            ctx.lineTo(ic.x, ic.y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            
            // 落点十字（红色/绿色）
            ctx.strokeStyle = color;
            ctx.lineWidth = 2 / state.map.scale;
            const cs = 7 / state.map.scale;
            ctx.beginPath();
            ctx.moveTo(ic.x - cs, ic.y);
            ctx.lineTo(ic.x + cs, ic.y);
            ctx.moveTo(ic.x, ic.y - cs);
            ctx.lineTo(ic.x, ic.y + cs);
            ctx.stroke();
            
            // 序号标签
            if (orderNum) {
                ctx.fillStyle = "#ef4444";
                ctx.font = `bold ${10 / state.map.scale}px Arial`;
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(orderNum, ic.x, ic.y - 13 / state.map.scale);
            }
        });
    }

    // 侦察机路线绘制
    let pvt = state.recon.pivot;
    let ang = state.recon.angle;
    let manGrid = document.getElementById('recon-grid')?.value;
    let manAng = parseFloat(document.getElementById('recon-angle')?.value);
    if (!state.recon.isMode && manGrid) {
        let m = manGrid.match(/([A-T]\d+)(?:\s+\[?(\d+):(\d+)\]?)?/i);
        if (m) {
            if (m[2] && m[3]) {
                let letter = m[1][0].toUpperCase();
                let mainNum = parseInt(m[1].slice(1));
                let ix = LETTERS.indexOf(letter);
                pvt = { x: ix + parseInt(m[2]) / 10 + 0.05, y: mainNum - 1 + parseInt(m[3]) / 10 + 0.05 };
            } else {
                let parsed = parseCoord(m[1]);
                if (parsed) pvt = { x: parsed.x, y: parsed.y };
            }
        } else {
            let parsed = parseCoord(manGrid);
            if (parsed) pvt = { x: parsed.x, y: parsed.y };
        }
        if (!isNaN(manAng)) ang = manAng;
    }
    if (pvt && !isNaN(ang)) {
        const rad = (90 - ang) * Math.PI / 180;
        const dirX = Math.cos(rad), dirY = Math.sin(rad);
        const entryDist = 0.85, entryX = pvt.x - dirX * entryDist, entryY = pvt.y - dirY * entryDist;
        const L = 13.9, w = 1.25;
        const poly = [
            {x: entryX - dirY*w, y: entryY + dirX*w},
            {x: entryX + dirY*w, y: entryY - dirX*w},
            {x: entryX + dirY*w + dirX*L, y: entryY - dirX*w + dirY*L},
            {x: entryX - dirY*w + dirX*L, y: entryY + dirX*w + dirY*L}
        ];
        const bounds = [
            { isInside: p => p.x >= 0, intersect: (S, E) => ({x: 0, y: S.y + (E.y-S.y)*(0-S.x)/(E.x-S.x)}) },
            { isInside: p => p.x <= 20, intersect: (S, E) => ({x: 20, y: S.y + (E.y-S.y)*(20-S.x)/(E.x-S.x)}) },
            { isInside: p => p.y >= 0, intersect: (S, E) => ({x: S.x + (E.x-S.x)*(0-S.y)/(E.y-S.y), y: 0}) },
            { isInside: p => p.y <= 10, intersect: (S, E) => ({x: S.x + (E.x-S.x)*(10-S.y)/(E.y-S.y), y: 10}) }
        ];
        let clipped = poly;
        bounds.forEach(b => {
            let out = []; if (clipped.length===0) return; let S = clipped[clipped.length-1];
            clipped.forEach(E => {
                if (b.isInside(E)) { if (!b.isInside(S)) out.push(b.intersect(S,E)); out.push(E); }
                else if (b.isInside(S)) out.push(b.intersect(S,E));
                S = E;
            });
            clipped = out;
        });
        if (clipped.length > 0) {
            ctx.fillStyle = "rgba(251, 191, 36, 0.2)";
            ctx.strokeStyle = "#fbbf24";
            ctx.lineWidth = 2 / state.map.scale;
            ctx.beginPath();
            let st = coordToCanvas(clipped[0]);
            ctx.moveTo(st.x, st.y);
            clipped.forEach(p => { let c = coordToCanvas(p); ctx.lineTo(c.x, c.y); });
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            let pc = coordToCanvas(pvt);
            ctx.fillStyle = "red";
            ctx.beginPath();
            ctx.arc(pc.x, pc.y, 4 / state.map.scale, 0, 7);
            ctx.fill();
        }
    }

    ctx.restore();
}

function resetMapView() {
    state.map.scale = 1;
    state.map.offsetX = 0;
    state.map.offsetY = 0;
    drawRadarMap();
}

function refreshMap() {
    drawRadarMap();
    renderMapPointsList();
}

function toggleMapItemDone(x, y) {
    const key = `${x.toFixed(2)},${y.toFixed(2)}`;
    if (!state.completed) state.completed = [];
    const idx = state.completed.indexOf(key);
    if (idx >= 0) {
        state.completed.splice(idx, 1);
    } else {
        state.completed.push(key);
    }
    saveState();
    renderMapPointsList();
    drawRadarMap();
}

function toggleMapItemPin(x, y) {
    const key = `${x.toFixed(2)},${y.toFixed(2)}`;
    if (!state.pinned) state.pinned = [];
    const idx = state.pinned.indexOf(key);
    if (idx >= 0) {
        state.pinned.splice(idx, 1);
    } else {
        state.pinned.unshift(key);
    }
    saveState();
    renderMapPointsList();
    drawRadarMap();
}

function getCoordNumber(key) {
    if (!state.numMap) state.numMap = {};
    if (state.numMap[key]) return state.numMap[key];
    const num = state._nextNum++;
    state.numMap[key] = num;
    saveState();
    return num;
}

function renderMapPointsList() {
    const container = document.getElementById('map-points-list');
    if (!container) return;
    
    const pinnedItems = [];
    const normalItems = [];
    const doneItems = [];
    
    const completedTargets = new Set();
    state.history.forEach(h => {
        if (h.completed && h.targetCoord) {
            const key = `${h.targetCoord.x.toFixed(2)},${h.targetCoord.y.toFixed(2)}`;
            completedTargets.add(key);
        }
    });
    (state.completed || []).forEach(k => completedTargets.add(k));
    
    function addItem(item) {
        const key = item.coord ? `${item.coord.x.toFixed(2)},${item.coord.y.toFixed(2)}` : '';
        const isPinned = key && (state.pinned || []).includes(key);
        const isDone = key && completedTargets.has(key);
        item.done = isDone;
        if (key) item.key = key;
        if (key && !item._noNum) {
            const num = getCoordNumber(key);
            const numStr = num <= 9 ? `#${num}` : `#${num}`;
            item.displayNum = numStr;
        }
        if (isPinned) {
            pinnedItems.push(item);
        } else if (isDone) {
            doneItems.push(item);
        } else {
            normalItems.push(item);
        }
    }
    
    if (state.cannonPos) {
        addItem({ type: 'gun', name: '铁巢', coord: state.cannonPos, _noNum: true });
    }
    
    state.points.spotter.forEach(p => {
        addItem({ type: 'spotter', name: p.name, coord: p.coord, _noNum: true });
    });
    
    state.points.ref.forEach(p => {
        addItem({ type: 'ref', name: p.name, coord: p.coord, _noNum: true });
    });
    
    state.points.target.forEach(p => {
        addItem({ type: 'target', name: p.name, coord: p.coord });
    });
    
    // 已从列表删除的已完成历史记录
    state.history.forEach(h => {
        if (h.completed && h.targetCoord) {
            const key = `${h.targetCoord.x.toFixed(2)},${h.targetCoord.y.toFixed(2)}`;
            const alreadyInList = state.points.target.some(p => `${p.coord.x.toFixed(2)},${p.coord.y.toFixed(2)}` === key);
            if (!alreadyInList) {
                addItem({ type: 'target', name: h.targetName || '历史目标', coord: h.targetCoord, _noNum: true });
            }
        }
    });
    
    const allCoords = new Set();
    [...pinnedItems, ...normalItems].forEach(i => { if (i.key) allCoords.add(i.key); });
    
    state.enemies
        .sort((a, b) => getEnemySortKey(a.displayName || a.name) - getEnemySortKey(b.displayName || b.name))
        .forEach(e => {
            const coordKey = `${e.x.toFixed(2)},${e.y.toFixed(2)}`;
            if (allCoords.has(coordKey)) return;
            addItem({ type: 'enemy', name: e.displayName || e.name, coord: { x: e.x, y: e.y }, rawName: e.name });
    });
    
    const items = [...pinnedItems, ...normalItems, ...doneItems];
    
    if (items.length === 0) {
        container.innerHTML = '<div style="color:#666;text-align:center;padding:20px;font-size:13px;">暂无可显示的点位</div>';
        return;
    }
    
    container.innerHTML = items.map(item => {
        const key = item.key || '';
        const isPinned = key && (state.pinned || []).includes(key);
        const displayName = item.displayNum ? `${item.displayNum} ${item.name}` : item.name;
        return `
        <div class="map-point-item ${item.type}${item.done ? ' done' : ''}${isPinned ? ' pinned' : ''}">
            <div>
                <div class="mp-name">${displayName}</div>
                <div class="mp-pos">${item.coord ? coordToDisplay(item.coord.x, item.coord.y) : '未知坐标'}</div>
            </div>
            <div style="display:flex;gap:4px;align-items:center;">
                ${item.coord && item.type !== 'gun' ? `
                    <button class="p-btn" onclick="usePointAsTarget('${item.type}', '${item.name}', '${item.rawName || item.name}')">设为目标</button>
                    ${(item.type === 'enemy' || item.type === 'target') ? `<button class="p-btn" onclick="strikePoint('${item.type}', '${item.name}', '${item.rawName || item.name}')">打击</button>` : ''}
                    <button class="p-btn p-btn-small" onclick="toggleMapItemPin(${item.coord.x.toFixed(2)}, ${item.coord.y.toFixed(2)})" title="${isPinned ? '取消置顶' : '置顶'}">${isPinned ? '⬆' : '⬆'}</button>
                    <button class="p-btn ${item.done ? 'p-btn-undo' : ''}" onclick="toggleMapItemDone(${item.coord.x.toFixed(2)}, ${item.coord.y.toFixed(2)})">${item.done ? '取消完成' : '完成'}</button>
                ` : ''}
            </div>
        </div>`;
    }).join('');
}

function updateQueueAutoStrikeVisualState() {
    document.body.classList.toggle('queue-auto-strike-active', !!state.queueAutoStrike);
}

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', () => {
    loadState();
    
    if (!state.cannonPos) {
        const defaultCannon = parseCoord('C2 3:4');
        if (defaultCannon) {
            state.cannonPos = defaultCannon;
            updateCannonDisplay();
        }
    }
    
    updatePointSelects();
    
    const mapAutoFireToggle = document.getElementById('map-auto-fire-toggle');
    if (mapAutoFireToggle) {
        mapAutoFireToggle.checked = !!state.mapAutoFire;
        mapAutoFireToggle.addEventListener('change', () => {
            state.mapAutoFire = mapAutoFireToggle.checked;
            saveState();
        });
    }

    const mapMaxChargeToggle = document.getElementById('map-max-charge-toggle');
    if (mapMaxChargeToggle) {
        mapMaxChargeToggle.checked = !!state.mapMaxCharge;
        mapMaxChargeToggle.addEventListener('change', () => {
            state.mapMaxCharge = mapMaxChargeToggle.checked;
            saveState();
        });
    }

    const queueAutoRefreshToggle = document.getElementById('queue-auto-refresh');
    if (queueAutoRefreshToggle) {
        queueAutoRefreshToggle.addEventListener('change', () => {
            if (queueAutoRefreshToggle.checked) {
                refreshQueue();
            }
        });
    }

    const queueAutoStrikeToggle = document.getElementById('queue-auto-strike');
    if (queueAutoStrikeToggle) {
        queueAutoStrikeToggle.checked = !!state.queueAutoStrike;
        updateQueueAutoStrikeVisualState();
        queueAutoStrikeToggle.addEventListener('change', async () => {
            state.queueAutoStrike = queueAutoStrikeToggle.checked;
            updateQueueAutoStrikeVisualState();
            saveState();
            if (queueAutoStrikeToggle.checked) {
                await refreshQueue();
            }
        });
    }
});
