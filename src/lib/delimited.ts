const SUPPORTED_FILE_NAME = /\.(?:csv|tsv)$/i;

export function parseDelimitedText(contents: string, fileName: string): unknown[][] {
  if (!SUPPORTED_FILE_NAME.test(fileName)) {
    throw new Error("CSVまたはTSVファイルを選択してください。");
  }
  if (contents.includes("\0")) throw new Error("ファイルに読み取れない文字が含まれています。");

  const text = contents.startsWith("\uFEFF") ? contents.slice(1) : contents;
  const delimiter = fileName.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? "";
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error("引用符が閉じられていないため、ファイルを読み取れません。");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
