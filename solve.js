// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader): run(input)
// returns exactly {columns, rows, errors} as csv-reader does, but finds field
// ends with native indexOf scans (plus one precomputed table of CR positions,
// so a CR check never runs past the field) and slices fields in one go,
// instead of building them a character at a time.
//
// Semantics (from the reference program, reimplemented here, not copied):
//   - String(input.text); header is (input.header === true); a U+FEFF at the
//     very start is dropped.
//   - A record ends at LF or CRLF; a line left with no characters is no record.
//   - Outside quotes a CR not followed by LF is dropped (error stray_cr).
//   - A field opening with '"' runs to the next quote that is not doubled;
//     "" inside is one literal quote; each CRLF or lone CR inside becomes
//     '\n' in the value and counts a line. What follows the closing quote, up
//     to the next comma or line break, is appended as it stands (quote_junk
//     when the field ends, if anything was appended). A quote that never
//     closes is a literal character: the text after it is re-read as an
//     unquoted field starting with '"' (unterminated_quote, first).
//   - A quote inside an unquoted field is a literal character. Fields stay
//     strings, never trimmed or converted. A trailing comma makes a trailing
//     empty field.
//   - columns is the first record when header is true, else null ([] when
//     header is true and there are no records). rows holds the other records,
//     each padded with '' (short_row, fields: its count) or cut (long_row,
//     extra: the cut fields) to the first record's width. The header itself
//     never gets a short/long_row error.
//   - Each error is {code, line, row} in the order met; line is the 1-based
//     line the record starts on (counting every LF, CRLF and lone CR inside
//     quotes); row is the record's index in rows, null for the header. A
//     record's short_row/long_row comes when the record ends.
//   - A record that ends up as a single empty UNQUOTED field is no record,
//     but its stray_cr errors stay.
//
// Pure and deterministic: no clock, no randomness, no state kept from one
// run() call to the next.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on, its index in rows (null: header).
  let recordLine = 1;
  let recordRow = null;

  // Every CR's position, in order (one forward pass). A CR is rare in places
  // and frequent in others, so scanning for it per field would run far past
  // the field; the table makes the next CR a pointer lookup instead.
  const crs = [];
  {
    let i = text.indexOf('\r');
    while (i !== -1) {
      crs.push(i);
      i = text.indexOf('\r', i + 1);
    }
  }
  let crIdx = 0;
  // First CR at or after from (-1: none). The pointer only moves forward.
  function nextCr(from) {
    while (crIdx < crs.length && crs[crIdx] < from) crIdx += 1;
    return crIdx < crs.length ? crs[crIdx] : -1;
  }

  // The field just read: value, how it ended (0 comma, 1 line break, 2 end),
  // and how many characters the unquoted scan kept (for quote_junk).
  let fVal = '';
  let fEnd = 0;
  let fAdded = 0;

  function err(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Sets fVal/fEnd/fAdded.
  // The nearest of comma / LF comes from indexOf (short scans); the nearest
  // CR from the table, so no scan ever runs past the field.
  function unq(value) {
    let v = value;
    let added = 0;
    for (;;) {
      const ci = text.indexOf(',', pos);
      const ni = text.indexOf('\n', pos);
      let m = ci;
      let k = 0; // 0 comma, 1 LF
      if (ni !== -1 && (m === -1 || ni < m)) { m = ni; k = 1; }
      const cr = nextCr(pos);
      if (cr !== -1 && (m === -1 || cr < m)) {
        if (text[cr + 1] === '\n') {
          // CRLF ends the field (m is its LF).
          if (cr > pos) {
            const s = text.slice(pos, cr);
            if (v.length === 0) v = s; else v += s;
            added += cr - pos;
          }
          pos = cr + 2;
          line += 1;
          fEnd = 1;
          break;
        }
        if (cr > pos) {
          const s = text.slice(pos, cr);
          if (v.length === 0) v = s; else v += s;
          added += cr - pos;
        }
        err('stray_cr');
        pos = cr + 1;
        continue;
      }
      if (m === -1) {
        if (pos < len) {
          const s = text.slice(pos);
          if (v.length === 0) v = s; else v += s;
          added += len - pos;
        }
        pos = len;
        fEnd = 2;
        break;
      }
      if (m > pos) {
        const s = text.slice(pos, m);
        if (v.length === 0) v = s; else v += s;
        added += m - pos;
      }
      if (k === 0) {
        pos = m + 1;
        fEnd = 0;
      } else {
        pos = m + 1;
        line += 1;
        fEnd = 1;
      }
      break;
    }
    fVal = v;
    fAdded = added;
  }

  // A quoted field whose opening quote is at pos: "" inside is one quote and
  // each CRLF or lone CR inside is one '\n'; the line counter moves with them.
  function quotedSlow(open, q, doubled) {
    const seg = text.slice(open + 1, q);
    // Count the line breaks in seg: every '\r' (from the table), and every
    // '\n' not after '\r'.
    let n = 0;
    while (crIdx < crs.length && crs[crIdx] < q) {
      if (crs[crIdx] >= open + 1) n += 1;
      crIdx += 1;
    }
    let i = seg.indexOf('\n');
    while (i !== -1) {
      if (seg[i - 1] !== '\r') n += 1;
      i = seg.indexOf('\n', i + 1);
    }
    line += n;
    let v = seg;
    if (doubled) v = v.replace(/""/g, '"');
    if (n > 0) v = v.replace(/\r\n?/g, '\n');
    return v;
  }

  // Reads a quoted field whose opening quote is at pos. Sets fVal/fEnd/fAdded.
  function qfield() {
    const open = pos;
    const openLine = line;
    // The closing quote is a '"' not followed by '"'.
    let q = text.indexOf('"', open + 1);
    let doubled = false;
    while (q !== -1 && text[q + 1] === '"') {
      doubled = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as an unquoted field.
      pos = open + 1;
      line = openLine;
      err('unterminated_quote');
      unq('"');
      return;
    }
    let v;
    if (!doubled) {
      // Fast path: no CR or LF inside the quotes, so the value is one slice.
      // The CR comes from the table; the LF from indexOf (a line away at most).
      const cr = nextCr(open + 1);
      const lf = text.indexOf('\n', open + 1);
      if ((cr === -1 || cr >= q) && (lf === -1 || lf >= q)) {
        v = text.slice(open + 1, q);
      } else {
        v = quotedSlow(open, q, false);
      }
    } else {
      v = quotedSlow(open, q, true);
    }
    pos = q + 1;
    if (pos >= len) {
      fVal = v;
      fEnd = 2;
      fAdded = 0;
      return;
    }
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      fVal = v;
      fEnd = 0;
      fAdded = 0;
      return;
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      fVal = v;
      fEnd = 1;
      fAdded = 0;
      return;
    }
    if (c === '\r' && text[pos + 1] === '\n') {
      pos += 2;
      line += 1;
      fVal = v;
      fEnd = 1;
      fAdded = 0;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break.
    unq(v);
    if (fAdded > 0) err('quote_junk');
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text[pos];
      if (c === '\n') {
        pos += 1;
        line += 1;
      } else if (c === '\r' && text[pos + 1] === '\n') {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted;
    do {
      if (text[pos] === '"') {
        qfield();
        quoted = true;
      } else {
        unq('');
        quoted = false;
      }
      fields.push(fVal);
    } while (fEnd === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
