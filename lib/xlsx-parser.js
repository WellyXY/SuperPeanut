(function () {
  const decoder = new TextDecoder("utf-8");
  const strictDecoder = new TextDecoder("utf-8", { fatal: true });
  const u16 = (view, offset) => view.getUint16(offset, true);
  const u32 = (view, offset) => view.getUint32(offset, true);

  async function inflate(compression, data) {
    if (compression === 0) return data;
    if (compression !== 8 || typeof DecompressionStream === "undefined") {
      throw new Error("当前浏览器无法解压该 XLSX 文件，请使用最新版 Chrome。");
    }
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    let end = -1;
    for (let i = Math.max(0, view.byteLength - 65557); i <= view.byteLength - 22; i += 1) {
      if (u32(view, i) === 0x06054b50) end = i;
    }
    if (end < 0) throw new Error("文件不是有效的 XLSX 压缩包。");
    const count = u16(view, end + 10);
    const centralOffset = u32(view, end + 16);
    const files = new Map();
    let cursor = centralOffset;
    for (let i = 0; i < count; i += 1) {
      if (u32(view, cursor) !== 0x02014b50) throw new Error("XLSX 目录读取失败。");
      const compression = u16(view, cursor + 10);
      const compressedSize = u32(view, cursor + 20);
      const nameLength = u16(view, cursor + 28);
      const extraLength = u16(view, cursor + 30);
      const commentLength = u16(view, cursor + 32);
      const localOffset = u32(view, cursor + 42);
      const name = decoder.decode(new Uint8Array(arrayBuffer, cursor + 46, nameLength));
      if (u32(view, localOffset) !== 0x04034b50) throw new Error("XLSX 本地文件读取失败。");
      const localNameLength = u16(view, localOffset + 26);
      const localExtraLength = u16(view, localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = new Uint8Array(arrayBuffer, dataStart, compressedSize);
      files.set(name, await inflate(compression, compressed));
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return files;
  }

  function xmlText(file) {
    let source = "";
    try {
      source = strictDecoder.decode(file);
    } catch {
      throw new Error("XLSX 内含损坏的文字编码。请用 Excel 另存为新的 .xlsx 后重新导入。");
    }
    const xml = new DOMParser().parseFromString(source, "application/xml");
    if (xml.querySelector("parsererror")) throw new Error("XLSX 工作表 XML 无法解析，请重新另存文件后导入。");
    return xml;
  }

  function columnIndex(ref) {
    const letters = (ref.match(/[A-Z]+/i) || ["A"])[0].toUpperCase();
    return [...letters].reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  }

  function textOf(node) {
    return [...node.querySelectorAll("t")].map((part) => part.textContent || "").join("") || node.textContent || "";
  }

  const normalizedHeader = (value) => String(value || "").trim().toLowerCase().replace(/[\s_\-\/（）()]+/g, "");
  const titleHeaders = new Set(["title", "岗位名称", "崗位名稱", "岗位", "崗位", "role", "position"].map(normalizedHeader));
  const knownHeaders = new Set([
    "title", "岗位名称", "崗位名稱", "岗位", "崗位", "role", "position",
    "company", "公司", "公司名称", "公司名稱", "雇主", "employer",
    "location", "国家/城市", "國家/城市", "地点", "地點", "城市", "base",
    "businessUnit", "事业部/产品线", "事業部/產品線", "事业部", "事業部", "产品线", "產品線",
    "function", "职能", "職能", "region", "大区", "大區", "priority", "优先级", "優先級",
    "HC", "headcount", "nationality", "国籍要求", "國籍要求", "note", "备注", "備註", "JD",
    "hiringManager", "HM", "招聘负责人", "招聘負責人", "updatedAt", "更新日期", "发布时间", "發佈時間",
  ].map(normalizedHeader));

  function rowsFromMatrix(matrix) {
    let headerIndex = -1;
    let headerScore = 0;
    matrix.slice(0, 25).forEach((row, index) => {
      const headers = row.map(normalizedHeader).filter(Boolean);
      const score = headers.filter((header) => knownHeaders.has(header)).length;
      if (headers.some((header) => titleHeaders.has(header)) && score > headerScore) {
        headerIndex = index;
        headerScore = score;
      }
    });
    if (headerIndex < 0) return { rows: [], headerScore: 0 };
    const headers = matrix[headerIndex].map((value) => String(value || "").trim());
    const rows = matrix.slice(headerIndex + 1)
      .filter((row) => row.some((value) => String(value).trim()))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header || `Column ${index + 1}`, row[index] ?? ""])));
    return { rows, headerScore };
  }

  function matrixFromSheet(sheet, shared) {
    return [...sheet.querySelectorAll("sheetData > row")].map((row) => {
      const values = [];
      row.querySelectorAll("c").forEach((cell) => {
        const index = columnIndex(cell.getAttribute("r") || "A1");
        const type = cell.getAttribute("t");
        const valueNode = cell.querySelector("v");
        const raw = valueNode?.textContent || "";
        values[index] = type === "s" ? (shared[Number(raw)] || "") : type === "inlineStr" ? textOf(cell) : raw;
      });
      return values.map((value) => value ?? "");
    });
  }

  async function parseWorkbookData(arrayBuffer) {
    const files = await unzip(arrayBuffer);
    const sharedXml = files.get("xl/sharedStrings.xml");
    const shared = sharedXml ? [...xmlText(sharedXml).querySelectorAll("si")].map(textOf) : [];
    const workbook = files.get("xl/workbook.xml") ? xmlText(files.get("xl/workbook.xml")) : null;
    const relationships = files.get("xl/_rels/workbook.xml.rels") ? xmlText(files.get("xl/_rels/workbook.xml.rels")) : null;
    const sheetNodes = [...(workbook?.querySelectorAll("sheet") || [])];
    const sheets = sheetNodes.map((sheetNode, sheetIndex) => {
      const relationId = sheetNode.getAttribute("r:id");
      const relation = relationId && relationships ? [...relationships.querySelectorAll("Relationship")].find((item) => item.getAttribute("Id") === relationId) : null;
      const target = relation?.getAttribute("Target")?.replace(/^\/+/, "") || `worksheets/sheet${sheetIndex + 1}.xml`;
      const sheetPath = target.startsWith("xl/") ? target : `xl/${target.replace(/^\.\//, "")}`;
      const sheetFile = files.get(sheetPath);
      if (!sheetFile) return null;
      return { name: sheetNode.getAttribute("name") || `Sheet ${sheetIndex + 1}`, rows: matrixFromSheet(xmlText(sheetFile), shared) };
    }).filter(Boolean);
    if (!sheets.length) {
      const fallback = files.get("xl/worksheets/sheet1.xml");
      if (fallback) sheets.push({ name: "Sheet 1", rows: matrixFromSheet(xmlText(fallback), shared) });
    }
    if (!sheets.length) throw new Error("未找到工作表。");
    if (sheets.some((item) => item.rows.some((row) => row.some((value) => String(value).includes("\uFFFD"))))) {
      throw new Error("XLSX 单元格含有损坏字符（�），已停止导入以避免污染 HC 数据。");
    }
    const mapped = sheets.map((sheet) => rowsFromMatrix(sheet.rows));
    return {
      sheets,
      mappedRows: mapped.flatMap((item) => item.rows),
      headerScore: Math.max(0, ...mapped.map((item) => item.headerScore)),
    };
  }

  async function parseWorkbook(arrayBuffer) {
    return (await parseWorkbookData(arrayBuffer)).mappedRows;
  }

  function agentSheets(workbook) {
    let remainingCharacters = 3_500_000;
    return (workbook?.sheets || []).slice(0, 20).map((sheet, sheetIndex) => {
      const rows = [];
      for (const sourceRow of (sheet?.rows || []).slice(0, 600)) {
        if (remainingCharacters <= 0) break;
        const row = [];
        for (const sourceCell of (sourceRow || []).slice(0, 60)) {
          const cell = String(sourceCell ?? "").slice(0, Math.min(6000, remainingCharacters));
          remainingCharacters -= cell.length;
          row.push(cell);
          if (remainingCharacters <= 0) break;
        }
        rows.push(row);
      }
      return { name: String(sheet?.name || `Sheet ${sheetIndex + 1}`).slice(0, 120), rows };
    }).filter((sheet) => sheet.rows.length);
  }

  globalThis.SanyXlsx = { parseWorkbook, parseWorkbookData, agentSheets };
})();
