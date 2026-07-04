const { parse } = require("csv-parse/sync");

const CANONICAL_HEADERS = [
  "order_no",
  "type",
  "content",
  "A",
  "B",
  "C",
  "D",
  "E",
  "correct"
];

const HEADER_LABELS = {
  order_no: "Số thứ tự/TT",
  type: "Loại câu hỏi",
  content: "Nội dung câu hỏi",
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  E: "E",
  correct: "Đáp án đúng"
};

const HEADER_ALIASES = {
  "số thứ tự": "order_no",
  "so thu tu": "order_no",
  "tt": "order_no",
  "loại câu hỏi": "type",
  "loai cau hoi": "type",
  "nội dung câu hỏi": "content",
  "noi dung cau hoi": "content",
  "a": "A",
  "b": "B",
  "c": "C",
  "d": "D",
  "e": "E",
  "đáp án đúng": "correct",
  "dap an dung": "correct"
};

const TYPE_MAP = {
  "Một lựa chọn": "single",
  "Nhiều lựa chọn": "multi"
};

function removeDiacritics(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

function normalizeCell(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeHeader(header) {
  const compact = normalizeCell(header).toLowerCase();
  return HEADER_ALIASES[compact] || HEADER_ALIASES[removeDiacritics(compact)] || compact.toUpperCase();
}

function validateHeaders(actualHeaders) {
  const canonical = actualHeaders.map(normalizeHeader).filter(Boolean);
  const unknown = canonical.filter((header) => !CANONICAL_HEADERS.includes(header));
  if (unknown.length) {
    return {
      ok: false,
      message: `Header không nhận diện được: ${unknown.join(", ")}. Header hợp lệ: ${CANONICAL_HEADERS.map((key) => HEADER_LABELS[key]).join(", ")}`
    };
  }

  const required = ["order_no", "type", "content", "A", "B", "correct"];
  const missing = required.filter((header) => !canonical.includes(header));
  if (missing.length) {
    return {
      ok: false,
      message: `CSV thiếu cột bắt buộc: ${missing.map((key) => HEADER_LABELS[key]).join(", ")}`
    };
  }

  const optionOrder = ["A", "B", "C", "D", "E"].filter((letter) => canonical.includes(letter));
  const expectedOptionOrder = ["A", "B", "C", "D", "E"].slice(0, optionOrder.length);
  const contiguousOptions = optionOrder.every((letter, index) => letter === expectedOptionOrder[index]);
  if (!contiguousOptions) {
    return {
      ok: false,
      message: "Các cột lựa chọn phải liên tục theo thứ tự A, B, C, D, E. Nếu không dùng C/D/E thì bỏ trống hoặc bỏ các cột cuối, không được nhảy cột."
    };
  }

  const expected = ["order_no", "type", "content", ...optionOrder, "correct"];
  const sameOrder = expected.length === canonical.length && expected.every((header, index) => header === canonical[index]);
  if (!sameOrder) {
    return {
      ok: false,
      message: `Header phải theo thứ tự: ${expected.map((key) => HEADER_LABELS[key]).join(", ")}`
    };
  }

  return { ok: true, canonical };
}

function normalizeType(value) {
  const normalized = normalizeCell(value);
  return TYPE_MAP[normalized];
}

function validateCsv(buffer) {
  let rows;
  try {
    const preview = parse(buffer, {
      bom: true,
      to_line: 1,
      relax_column_count: true,
      trim: true
    });
    const headerResult = validateHeaders(preview[0] || []);
    if (!headerResult.ok) {
      return { ok: false, errors: [{ row: 0, message: headerResult.message }] };
    }

    rows = parse(buffer, {
      bom: true,
      columns: (headers) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true
    });
  } catch (error) {
    return { ok: false, errors: [{ row: 0, message: `Không đọc được CSV: ${error.message}` }] };
  }

  if (!rows.length) {
    return { ok: false, errors: [{ row: 0, message: "CSV không có dữ liệu." }] };
  }

  const errors = [];
  const questions = rows.map((row, index) => {
    const rowNumber = index + 2;
    const type = normalizeType(row.type);
    const content = normalizeCell(row.content);
    const options = {};
    ["A", "B", "C", "D", "E"].forEach((letter) => {
      const value = normalizeCell(row[letter]);
      if (value) options[letter] = value;
    });
    const optionLetters = Object.keys(options);
    const presentOptionLetters = ["A", "B", "C", "D", "E"].filter((letter) => normalizeCell(row[letter]));
    const expectedPresentOptionLetters = ["A", "B", "C", "D", "E"].slice(0, presentOptionLetters.length);
    const contiguousPresentOptions = presentOptionLetters.every((letter, letterIndex) => letter === expectedPresentOptionLetters[letterIndex]);
    const correct = String(row.correct || "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean);
    const uniqueCorrect = [...new Set(correct)];

    if (!type) errors.push({ row: rowNumber, message: "Loại câu hỏi phải là 'Một lựa chọn' hoặc 'Nhiều lựa chọn'." });
    if (!content) errors.push({ row: rowNumber, message: "Nội dung câu hỏi không được trống." });
    if (optionLetters.length < 2 || optionLetters.length > 5) errors.push({ row: rowNumber, message: "Số lựa chọn phải từ 2 đến 5." });
    if (!options.A || !options.B) errors.push({ row: rowNumber, message: "Mỗi câu hỏi phải có tối thiểu hai lựa chọn ở cột A và B." });
    if (!contiguousPresentOptions) errors.push({ row: rowNumber, message: "Các lựa chọn có dữ liệu phải liên tục từ A, B, C, D, E. Nếu một cột đang trống thì các cột lựa chọn phía sau cũng phải trống." });
    if (correct.length !== uniqueCorrect.length) errors.push({ row: rowNumber, message: "Đáp án đúng không được trùng lặp." });
    if (type === "single" && uniqueCorrect.length !== 1) errors.push({ row: rowNumber, message: "Câu một lựa chọn phải có đúng 1 đáp án." });
    if (type === "multi" && (uniqueCorrect.length < 2 || uniqueCorrect.length > 5)) errors.push({ row: rowNumber, message: "Câu nhiều lựa chọn phải có từ 2 đến 5 đáp án." });
    uniqueCorrect.forEach((letter) => {
      if (!optionLetters.includes(letter)) errors.push({ row: rowNumber, message: `Đáp án ${letter} không có trong các lựa chọn đã điền.` });
    });

    return {
      order_no: Number(row.order_no) || index + 1,
      type,
      content,
      options,
      correct: uniqueCorrect.sort()
    };
  });

  if (errors.length) return { ok: false, errors };
  return { ok: true, questions };
}

module.exports = { validateCsv, CANONICAL_HEADERS };
