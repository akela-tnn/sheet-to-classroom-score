chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "fetchCSV") {
    // 將一般 Google Sheet 網址轉換為 CSV 匯出網址
    let csvUrl = request.url;
    if (csvUrl.includes("/edit")) {
      csvUrl = csvUrl.replace(/\/edit.*$/, "/export?format=csv");
    }

    fetch(csvUrl)
      .then(response => {
        if (!response.ok) throw new Error("無法讀取 Sheet，請確認權限是否設為「知道連結的人皆可檢視」");
        return response.text();
      })
      .then(text => sendResponse({ success: true, data: text }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    
    return true; // 告知 Chrome 這是非同步請求
  }
});