let parsedSheetData = [];
let rawCsvLines = [];
let targetCellIndex = -1; 

// 1. 監聽點擊，精準紀錄「成績欄位」在該列的邏輯位置
document.addEventListener('focusin', (e) => {
  if (e.target.tagName === 'INPUT' && !e.target.closest('#csg-modal')) {
    let row = e.target.closest('[role="row"], tr');
    let cell = e.target.closest('[role="gridcell"], [role="cell"], td');
    
    if (row && cell) {
      let cells = Array.from(row.querySelectorAll('[role="gridcell"], [role="cell"], td'));
      targetCellIndex = cells.indexOf(cell);
    }
  }
});

function indexToColumn(index) {
  let res = '';
  let n = index;
  while (n >= 0) {
    res = String.fromCharCode((n % 26) + 65) + res;
    n = Math.floor(n / 26) - 1;
  }
  return res;
}

// 2. 注入 UI
function injectUI() {
  if (document.getElementById('csg-floating-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'csg-floating-btn';
  btn.textContent = '匯入 Sheet 成績';
  btn.onclick = openModal;
  document.body.appendChild(btn);
}

function openModal() {
  if (document.getElementById('csg-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'csg-modal-overlay';
  
  let lockStatus = targetCellIndex !== -1 ? 
    `<span style="color:#137333; font-weight:bold;">✅ 已成功鎖定目標欄位！(第 ${targetCellIndex + 1} 格)</span>` : 
    `<span style="color:#d93025; font-weight:bold;">❌ 尚未鎖定！請先關閉此視窗，點擊背後的成績框</span>`;

  overlay.innerHTML = `
    <div id="csg-modal">
      <h2>匯入成績設定</h2>
      <div>
        <label>Google Sheet 網址 (需設為公開檢視)：</label>
        <input type="text" id="csg-sheet-url" placeholder="貼上 Sheet 網址">
      </div>
      <div>
        <button class="csg-btn csg-btn-primary" id="csg-fetch-btn" style="width:100%">讀取 Sheet 資料</button>
      </div>
      <div id="csg-mapping-section" style="display:none; flex-direction:column; gap:16px;">
        <div>
          <label>選擇 Sheet 中的「成績來源欄位」：</label>
          <select id="csg-source-col"></select>
        </div>
        <div style="background:#f8f9fa; padding:10px; border-radius:4px; font-size:14px; text-align:center; border: 1px solid #dadce0;">
           ${lockStatus}
        </div>
        <div class="csg-btn-group">
          <button class="csg-btn csg-btn-cancel" id="csg-close-btn">取消</button>
          <button class="csg-btn csg-btn-primary" id="csg-execute-btn">開始填寫成績</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  document.getElementById('csg-close-btn')?.addEventListener('click', () => overlay.remove());
  document.getElementById('csg-fetch-btn').addEventListener('click', fetchSheetData);
  document.getElementById('csg-execute-btn').addEventListener('click', executeGrading);
}

// 3. 請求 Background 讀取 CSV
function fetchSheetData() {
  const rawUrl = document.getElementById('csg-sheet-url').value;
  if (!rawUrl) return alert('請輸入網址');

  let exportUrl = rawUrl;
  let gidMatch = rawUrl.match(/gid=([0-9]+)/);
  if (exportUrl.includes("/edit")) {
    exportUrl = exportUrl.replace(/\/edit.*$/, "/export?format=csv");
    if (gidMatch) exportUrl += "&gid=" + gidMatch[1];
  }

  const btn = document.getElementById('csg-fetch-btn');
  btn.textContent = '讀取中...';
  
  chrome.runtime.sendMessage({ action: "fetchCSV", url: exportUrl }, (response) => {
    btn.textContent = '讀取 Sheet 資料';
    if (response && response.success) {
      if (response.data.trim().toLowerCase().startsWith('<!doctype html') || response.data.includes('<html')) {
        alert('❌ 讀取失敗！請確認你的 Sheet 共用權限已設為「知道連結的任何人皆可檢視」！');
        document.getElementById('csg-mapping-section').style.display = 'none';
        return;
      }
      parseCSV(response.data);
      showMappingUI();
    } else {
      alert("讀取失敗：" + (response ? response.error : "未知錯誤"));
    }
  });
}

// 4. 解析 CSV (✨ 新增：自動過濾無效的表頭與課程名稱)
function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) return alert('資料格式錯誤，Sheet 可能為空。');

  rawCsvLines = lines.map(line => line.split(',').map(c => c.replace(/"/g, '').trim()));
  parsedSheetData = [];

  for (let i = 0; i < rawCsvLines.length; i++) {
    const cols = rawCsvLines[i];
    const A = cols[0] ? cols[0].replace(/\s+/g, '').toLowerCase() : '';
    const B = cols[1] ? cols[1].replace(/\s+/g, '').toLowerCase() : '';
    
    let possibleNames = new Set();
    if (A && B && !B.includes('@') && !A.includes('@')) {
        possibleNames.add(A + B);
        possibleNames.add(B + A); 
    }
    if (A && !A.includes('@')) possibleNames.add(A);
    if (B && !B.includes('@')) possibleNames.add(B);

    // 💡 排除姓名為「標題列」的無效資料，保持日誌乾淨
    let validNames = Array.from(possibleNames).filter(n => 
      n.length >= 2 && 
      n !== '姓氏' && n !== '名字' &&
      !n.includes('成績') && !n.includes('平均') && 
      !n.includes('測試用') && !n.includes('classroom') // 針對你的 Sheet 標題設定
    );
    
    if (validNames.length > 0) {
        parsedSheetData.push({ fullName: validNames[0], possibleNames: validNames, rawData: cols });
    }
  }
}

function showMappingUI() {
  document.getElementById('csg-mapping-section').style.display = 'flex';
  const sourceSelect = document.getElementById('csg-source-col');
  sourceSelect.innerHTML = '';
  
  const maxCols = rawCsvLines.reduce((max, row) => Math.max(max, row.length), 0);
  
  for (let i = 0; i < maxCols; i++) {
    const option = document.createElement('option');
    option.value = i;
    const colLetter = indexToColumn(i);
    
    let label = '';
    for (let r = 0; r < Math.min(4, rawCsvLines.length); r++) {
      if (rawCsvLines[r][i] && rawCsvLines[r][i] !== rawCsvLines[0][0]) {
        label = rawCsvLines[r][i];
        break;
      }
    }
    option.textContent = `${colLetter}欄 ${label ? `(${label})` : ''}`;
    sourceSelect.appendChild(option);
  }
}

// 5. 執行填寫邏輯
async function executeGrading() {
  if (targetCellIndex === -1) {
    alert("❌ 定位失敗！請先關閉此視窗，在背後的 Classroom 畫面上點擊你要輸入的那一欄成績框！");
    return;
  }

  const sourceColIndex = document.getElementById('csg-source-col').value;
  document.getElementById('csg-modal-overlay').remove();
  
  let matchCount = 0;
  const allRows = document.querySelectorAll('[role="row"], tr');
  let debugLogs = []; 
  
  let classroomStudents = [];
  for (let row of allRows) {
      let nameCell = row.querySelector('[role="rowheader"], th, td');
      if (!nameCell) continue;
      
      let crName = (nameCell.textContent || "").replace(/\s+/g, '').toLowerCase();
      if (!crName || crName.includes('平均') || crName.includes('排序') || crName.includes('滿分')) continue;
      
      classroomStudents.push({ name: crName, rowElement: row });
  }

  for (let sheetStudent of parsedSheetData) {
    let targetRow = null;
    let matchedName = "";

    let exactMatch = classroomStudents.find(cr => sheetStudent.possibleNames.some(n => n === cr.name));
    
    if (exactMatch) {
        targetRow = exactMatch.rowElement;
        matchedName = exactMatch.name;
    } else {
        let partialMatch = classroomStudents.find(cr => sheetStudent.possibleNames.some(n => n.length >= 2 && cr.name.includes(n)));
        if (partialMatch) {
            targetRow = partialMatch.rowElement;
            matchedName = partialMatch.name;
        }
    }

    if (targetRow) {
      let cells = Array.from(targetRow.querySelectorAll('[role="gridcell"], [role="cell"], td'));
      
      if (cells.length > targetCellIndex) {
        const rawScore = sheetStudent.rawData[sourceColIndex];
        
        if (rawScore !== undefined && String(rawScore).trim() !== "" && !isNaN(rawScore)) {
          const score = String(rawScore).trim();
          const cell = cells[targetCellIndex];
          let inputField = cell.querySelector('input, textarea');

          if (!inputField) {
            const innerEl = cell.querySelector('[tabindex="0"], button') || cell.firstElementChild || cell;
            innerEl.focus && innerEl.focus();
            innerEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            innerEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            innerEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
            innerEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            innerEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            innerEl.click();

            await new Promise(r => setTimeout(r, 250)); 
            inputField = cell.querySelector('input, textarea');
          }

          if (inputField) {
            fillReactInput(inputField, score);
            matchCount++;
            debugLogs.push(`✅ [${sheetStudent.fullName}] (${matchedName}) 成功填入：${score}`);
            await new Promise(r => setTimeout(r, 150)); 
          } else {
            debugLogs.push(`❌ [${sheetStudent.fullName}] 點擊失敗！無法打開輸入框。`);
          }
        } else {
          debugLogs.push(`⚠️ [${sheetStudent.fullName}] Sheet中的分數無效或空白`);
        }
      } else {
        debugLogs.push(`❌ [${sheetStudent.fullName}] 網格定位偏移。`);
      }
    } else {
      debugLogs.push(`❓ [${sheetStudent.fullName}] 在 Classroom 畫面上找不到這個人。`);
    }
  }
  
  if (matchCount === 0) {
    alert(`填寫失敗！\n\n🔍 詳細診斷報告：\n${debugLogs.join('\n')}`);
  } else {
    alert(`✅ 填寫完成！共成功填入 ${matchCount} 筆成績。\n\n詳細紀錄：\n${debugLogs.join('\n')}\n\n請手動確認後點擊「發還」。`);
  }
}

// 6. 模擬 React 環境下的輸入事件
function fillReactInput(input, value) {
  input.focus();
  input.value = value;
  const tracker = input._valueTracker;
  if (tracker) tracker.setValue(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
  input.blur(); 
}

setInterval(injectUI, 3000);