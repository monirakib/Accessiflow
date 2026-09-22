// AccessiFlow screen reader: tables
//
// Reading a table line by line tells a blind user nothing about which column
// a number belongs to. Screen readers solve it with Control+Alt+arrows: move
// one cell at a time, and hear the header of the column (or row) whenever it
// changes. "Price, column 2, 3 taka" is one keypress; working that out from a
// flat list of cells is not something anyone can do in their head.
//
// This is the table maths: the grid a table really forms once cells span
// rows and columns, and which cells are headers. HTML tables and ARIA
// role="table"/"grid" tables both count.
'use strict';

(function (root) {
  const CELL_ROLES = { cell: 1, gridcell: 1, columnheader: 1, rowheader: 1 };

  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

  function roleOf(el) {
    return clean(el.getAttribute && el.getAttribute('role')).split(' ')[0].toLowerCase();
  }

  function isTable(el) {
    if (!el || el.nodeType !== 1) return false;
    const role = roleOf(el);
    if (role === 'presentation' || role === 'none') return false;
    return (el.tagName === 'TABLE' && !role) || role === 'table' || role === 'grid' || role === 'treegrid';
  }

  function isCell(el) {
    if (!el || el.nodeType !== 1) return false;
    const role = roleOf(el);
    if (CELL_ROLES[role]) return true;
    return !role && (el.tagName === 'TD' || el.tagName === 'TH');
  }

  /** The cell a node sits in, or null if it is not inside a table. */
  function cellOf(node) {
    let n = node && node.nodeType === 3 ? node.parentElement : node;
    for (; n; n = n.parentElement) {
      if (isCell(n)) return n;
      if (isTable(n)) return null;
    }
    return null;
  }

  function tableOf(cell) {
    for (let n = cell && cell.parentElement; n; n = n.parentElement) if (isTable(n)) return n;
    return null;
  }

  function ownedBy(table, el) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      if (isTable(n)) return n === table;
    }
    return false;
  }

  /** Rows, each a list of cells, in the order they appear. */
  function rowsOf(table) {
    if (table.tagName === 'TABLE' && table.rows) {
      return Array.prototype.map.call(table.rows, row => Array.prototype.slice.call(row.cells));
    }
    const rows = Array.prototype.filter.call(table.querySelectorAll('[role="row"]'), row => ownedBy(table, row));
    return rows.map(row => Array.prototype.filter.call(row.querySelectorAll('*'), c => isCell(c) &&
      c.closest('[role="row"]') === row));
  }

  /**
   * The table as a grid: every row and column position holds the cell that
   * covers it, so a cell spanning two columns appears in both.
   */
  function grid(table) {
    const matrix = [];
    const pos = new Map();
    rowsOf(table).forEach((cells, r) => {
      matrix[r] = matrix[r] || [];
      let c = 0;
      cells.forEach(cell => {
        while (matrix[r][c]) c++;
        const cols = Math.max(1, Number(cell.colSpan || cell.getAttribute('aria-colspan')) || 1);
        const rows = Math.max(1, Number(cell.rowSpan || cell.getAttribute('aria-rowspan')) || 1);
        pos.set(cell, { row: r, col: c, rows: rows, cols: cols });
        for (let dr = 0; dr < rows; dr++) {
          matrix[r + dr] = matrix[r + dr] || [];
          for (let dc = 0; dc < cols; dc++) matrix[r + dr][c + dc] = cell;
        }
        c += cols;
      });
    });
    const cols = matrix.reduce((max, row) => Math.max(max, row.length), 0);
    return { table: table, matrix: matrix, pos: pos, rows: matrix.length, cols: cols };
  }

  function isColumnHeader(cell) {
    const role = roleOf(cell);
    if (role === 'columnheader') return true;
    if (role || cell.tagName !== 'TH') return false;
    const scope = (cell.getAttribute('scope') || '').toLowerCase();
    if (scope === 'col' || scope === 'colgroup') return true;
    if (scope === 'row' || scope === 'rowgroup') return false;
    const row = cell.parentElement;
    if (row && row.parentElement && row.parentElement.tagName === 'THEAD') return true;
    // A row of nothing but <th> is a header row.
    return !!(row && row.cells && Array.prototype.every.call(row.cells, c => c.tagName === 'TH'));
  }

  function isRowHeader(cell) {
    const role = roleOf(cell);
    if (role === 'rowheader') return true;
    if (role || cell.tagName !== 'TH') return false;
    const scope = (cell.getAttribute('scope') || '').toLowerCase();
    if (scope === 'row' || scope === 'rowgroup') return true;
    return !isColumnHeader(cell);
  }

  function cellText(cell) {
    const N = root.AccessiFlowNaming;
    const name = N ? N.accessibleName(cell) : clean(cell.textContent);
    return clean(name);
  }

  /** Cells named in a headers="…" attribute win over any guess. */
  function explicitHeaders(cell) {
    const ids = clean(cell.getAttribute('headers'));
    if (!ids) return null;
    return ids.split(' ').map(id => cell.ownerDocument.getElementById(id)).filter(Boolean);
  }

  function columnHeader(g, row, col) {
    const cell = g.matrix[row] && g.matrix[row][col];
    const explicit = cell && explicitHeaders(cell);
    if (explicit) {
      const cols = explicit.filter(h => isColumnHeader(h) || !isRowHeader(h));
      if (cols.length) return cols.map(cellText).join(' ');
    }
    const found = [];
    for (let r = 0; r < row; r++) {
      const h = g.matrix[r] && g.matrix[r][col];
      if (h && h !== cell && isColumnHeader(h) && found.indexOf(h) === -1) found.push(h);
    }
    return found.map(cellText).filter(Boolean).join(' ');
  }

  function rowHeader(g, row, col) {
    const cell = g.matrix[row] && g.matrix[row][col];
    const explicit = cell && explicitHeaders(cell);
    if (explicit) {
      const rows = explicit.filter(isRowHeader);
      if (rows.length) return rows.map(cellText).join(' ');
    }
    for (let c = 0; c < col; c++) {
      const h = g.matrix[row] && g.matrix[row][c];
      if (h && h !== cell && isRowHeader(h)) return cellText(h);
    }
    return '';
  }

  /**
   * One cell on from `from` in a direction, stepping past the other positions
   * of a spanning cell. Null at the edge of the table.
   */
  function step(g, from, dRow, dCol) {
    const start = g.matrix[from.row] && g.matrix[from.row][from.col];
    let r = from.row;
    let c = from.col;
    // Start from the far edge of a span in the direction of travel.
    if (start && g.pos.get(start)) {
      const p = g.pos.get(start);
      if (dRow > 0) r = p.row + p.rows - 1;
      if (dCol > 0) c = p.col + p.cols - 1;
      if (dRow < 0) r = p.row;
      if (dCol < 0) c = p.col;
      if (!dRow) r = from.row;
      if (!dCol) c = from.col;
    }
    for (;;) {
      r += dRow;
      c += dCol;
      if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) return null;
      const cell = g.matrix[r] && g.matrix[r][c];
      if (cell && cell !== start) return { cell: cell, row: r, col: c };
    }
  }

  root.AccessiFlowSRTable = {
    isTable, isCell, cellOf, tableOf, grid, step, columnHeader, rowHeader,
    isColumnHeader, isRowHeader, cellText
  };
})(typeof window !== 'undefined' ? window : globalThis);
