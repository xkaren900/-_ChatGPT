/* Pure domain model. No Google services, storage, clocks or credentials. */
var WarehouseCore = (() => {
  'use strict';
  const SCHEMA = 4;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const copy = value => JSON.parse(JSON.stringify(value));
  const empty = () => ({schema: SCHEMA, parts: [], locations: [], stocks: []});
  const fail = message => { throw new Error(message); };
  function text(value, limit, label, required) {
    // Preserve literal text, including leading whitespace and apostrophes.
    const result = value == null ? '' : String(value);
    if (required && !result.trim()) fail(label + '不可空白');
    if (result.length > limit) fail(label + '長度超過限制');
    return result;
  }
  function code(value) {
    if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) fail('編號只接受英文、數字、底線及連字號，最多100字');
    return value;
  }
  function version(record, expected) {
    if (!record) fail('找不到資料');
    if (!Number.isSafeInteger(expected) || expected !== record.version) fail('資料版本衝突，請重新載入');
  }
  function location(state, id) { return state.locations.find(x => x.id === id); }
  function activeLocation(state, id) {
    if (id === null) return;
    const target = location(state, id);
    if (!target || target.status !== 'ACTIVE') fail('上級位置不存在或尚未啟用');
  }
  function parentId(value) {
    if (value === null || value === '') return null;
    return code(value);
  }
  function uniqueCode(state, id) {
    if (state.parts.concat(state.locations).some(x => x.id.toLowerCase() === id.toLowerCase())) fail('編號已使用');
  }
  function amount(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12) fail('數量必須為有效非負數且不超過上限');
    const rounded = Math.round(value * 1e6) / 1e6;
    if (Math.abs(rounded - value) > 1e-9) fail('數量最多六位小數');
    return rounded;
  }
  function quantity(value, state) {
    if (state === 'UNKNOWN') {
      if (value !== null) fail('未知數量必須留空');
      return null;
    }
    if (state !== 'KNOWN') fail('無效的數量狀態');
    return amount(value);
  }
  const stockKey = (partId, locationId) => JSON.stringify([partId, locationId]);
  function partFields(input) {
    return {
      name: text(input.name, 200, '零件名稱', true),
      manufacturer: text(input.manufacturer, 200, '製造商'),
      mpn: text(input.mpn, 200, 'MPN'), specification: text(input.specification, 1000, '規格'),
      unit: text(input.unit, 30, '單位') || '個', barcode: text(input.barcode, 200, '條碼'),
      note: text(input.note, 5000, '備註')
    };
  }
  function locationFields(input) {
    const status = input.status || 'ACTIVE';
    if (!['ACTIVE', 'RESERVED'].includes(status)) fail('無效的儲位狀態');
    if (!['room', 'cabinet', 'box'].includes(input.type)) fail('儲位種類無效');
    return {name: text(input.name, 200, '儲位名稱', status === 'ACTIVE'), type: input.type,
      status, note: text(input.note, 5000, '備註')};
  }
  function replay(events) {
    const state = empty(), seen = new Set();
    for (const event of events) {
      if (event.schema !== SCHEMA || !Array.isArray(event.changes)) fail('資料日誌版本不符');
      if (seen.has(event.requestId)) fail('資料日誌包含重複請求，請停止寫入並檢查');
      seen.add(event.requestId);
      for (const change of event.changes) {
        if (!['parts','locations','stocks'].includes(change.table)) fail('日誌資料表無效');
        const rows = state[change.table], index = rows.findIndex(x => x.id === change.after.id);
        const before = index < 0 ? null : rows[index];
        if (JSON.stringify(before) !== JSON.stringify(change.before)) fail('資料日誌順序或內容不一致');
        if (index < 0) rows.push(copy(change.after)); else rows[index] = copy(change.after);
      }
    }
    return state;
  }
  function plan(state, command, context) {
    if (!command || typeof command !== 'object') fail('請求內容無效');
    const {action} = command, input = command.input || {}, time = context.time;
    const reason = text(command.reason, 500, '原因');
    const changes = [];
    let result;
    function save(table, before, after) {
      changes.push({table, before: before ? copy(before) : null, after: copy(after)});
      return after;
    }
    function newStock(partId, targetId, initial, initialState) {
      const part = state.parts.find(x => x.id === partId);
      if (!part || part.status !== 'ACTIVE') fail('零件不存在或已停用');
      activeLocation(state, targetId);
      const id = stockKey(partId, targetId);
      if (state.stocks.some(x => x.id === id)) fail('此零件在該儲位已有庫存記錄，請使用數量調整');
      return save('stocks', null, {id, partId, locationId: targetId,
        quantity: quantity(initial, initialState), quantityState: initialState, version: 1, updatedAt: time});
    }
    if (action === 'createPart' || action === 'createLocation') {
      const id = code(command.code || context.generatedCode); uniqueCode(state, id);
      const common = {id, code: id, createdAt: time, updatedAt: time, version: 1,
        photoId: context.photoId || ''};
      if (action === 'createPart') {
        result = save('parts', null, {...common, ...partFields(input), status: 'ACTIVE'});
        if (own(command, 'initialStock')) {
          const initial = command.initialStock;
          if (!initial || typeof initial !== 'object') fail('初始庫存無效');
          // New part is not yet in state; validate the initial stock independently.
          const targetId = parentId(initial.locationId);
          activeLocation(state, targetId);
          save('stocks', null, {id: stockKey(id, targetId), partId: id, locationId: targetId,
            quantity: quantity(initial.quantity, initial.quantityState), quantityState: initial.quantityState,
            version: 1, updatedAt: time});
        }
      } else {
        const targetId = parentId(input.parentId);
        activeLocation(state, targetId);
        result = save('locations', null, {...common, ...locationFields(input), parentId: targetId});
      }
    } else if (action === 'updatePart') {
      const before = state.parts.find(x => x.id === command.id); version(before, command.expectedVersion);
      if (before.status !== 'ACTIVE') fail('停用零件不可修改');
      result = save('parts', before, {...before, ...partFields({...before, ...input}), version: before.version + 1, updatedAt: time});
    } else if (action === 'updateLocation') {
      const before = location(state, command.id); version(before, command.expectedVersion);
      const fields = locationFields({...before, ...input});
      if (fields.status === 'RESERVED' && (state.locations.some(x => x.parentId === before.id) || state.stocks.some(x => x.locationId === before.id))) fail('此儲位仍有子儲位或庫存，不可改為預留');
      result = save('locations', before, {...before, ...fields, updatedAt: time, version: before.version + 1});
    } else if (action === 'moveLocation') {
      const before = location(state, command.id); version(before, command.expectedVersion);
      const targetId = parentId(command.parentId); activeLocation(state, targetId);
      if (targetId === before.parentId) fail('位置未改變');
      let next = targetId; const visited = new Set();
      while (next !== null) {
        if (next === before.id || visited.has(next)) fail('不能移入自己或下層內容物');
        visited.add(next); const ancestor = location(state, next);
        if (!ancestor) fail('儲位階層不完整'); next = ancestor.parentId;
      }
      result = save('locations', before, {...before, parentId: targetId, updatedAt: time, version: before.version + 1});
    } else if (action === 'createStock') {
      result = newStock(command.partId, parentId(command.locationId), command.quantity, command.quantityState);
    } else if (action === 'adjustQuantity') {
      const before = state.stocks.find(x => x.id === command.stockId); version(before, command.expectedVersion);
      const part = state.parts.find(x => x.id === before.partId);
      if (!part || part.status !== 'ACTIVE') fail('零件不存在或已停用');
      activeLocation(state, before.locationId);
      const operation = command.operation;
      if (!['increase','decrease','set','unknown'].includes(operation)) fail('數量操作無效');
      text(command.reason, 500, '原因');
      let next, nextState = 'KNOWN';
      if (operation === 'unknown') {
        if (before.quantityState === 'UNKNOWN') fail('數量未改變');
        if (command.amount !== null) fail('未知數量必須留空');
        next = null; nextState = 'UNKNOWN';
      } else {
        const delta = amount(command.amount);
        if (operation !== 'set' && (delta === 0 || before.quantityState !== 'KNOWN')) fail('未知數量須先盤點，增減量必須大於0');
        next = operation === 'set' ? delta : amount(Math.round((before.quantity + (operation === 'increase' ? delta : -delta)) * 1e6) / 1e6);
        if (before.quantityState === 'KNOWN' && next === before.quantity) fail('數量未改變');
      }
      result = save('stocks', before, {...before, quantity: next, quantityState: nextState, updatedAt: time, version: before.version + 1});
    } else if (action === 'transferStock') {
      const from = state.stocks.find(x => x.id === command.fromStockId), to = state.stocks.find(x => x.id === command.toStockId);
      version(from, command.expectedFromVersion); version(to, command.expectedToVersion);
      if (from.id === to.id || from.partId !== to.partId) fail('轉移必須為同一零件的不同儲位');
      const part = state.parts.find(x => x.id === from.partId);
      if (!part || part.status !== 'ACTIVE') fail('零件不存在或已停用');
      activeLocation(state, from.locationId); activeLocation(state, to.locationId);
      if (from.quantityState !== 'KNOWN' || to.quantityState !== 'KNOWN') fail('轉移前須先盤點兩端數量');
      const delta = amount(command.amount); if (!delta) fail('轉移數量必須大於0');
      text(command.reason, 500, '原因');
      const afterFrom = {...from, quantity: amount(Math.round((from.quantity - delta) * 1e6) / 1e6), version: from.version + 1, updatedAt: time};
      const afterTo = {...to, quantity: amount(Math.round((to.quantity + delta) * 1e6) / 1e6), version: to.version + 1, updatedAt: time};
      save('stocks', from, afterFrom); save('stocks', to, afterTo);
      result = {from: afterFrom, to: afterTo};
    } else fail('不支援的操作');
    return {schema: SCHEMA, requestId: command.requestId, fingerprint: context.fingerprint,
      time, actor: '共用金鑰', action, reason, changes, result: copy(result)};
  }
  function summary(state, partId) {
    const stocks = state.stocks.filter(x => x.partId === partId);
    const known = stocks.filter(x => x.quantityState === 'KNOWN').reduce((sum,x) => sum + x.quantity, 0);
    return {known: Math.round(known * 1e6) / 1e6, unknown: stocks.filter(x => x.quantityState === 'UNKNOWN').length, locations: stocks.length};
  }
  return {SCHEMA, empty, replay, plan, summary, stockKey, amount, copy};
})();
