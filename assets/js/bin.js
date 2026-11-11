// The bin view: the page as a binary under analysis. Styles are in _sass/_bin.scss.
//
// The inline script in _includes/head.liquid has already put data-style="src|bin" on <html>,
// so the right skin is painted from the start. This file wires the src | bin switch and runs the
// parts that only exist in the bin view: the ELF header read out above the name, the name
// decoding from its bytes, the pixel-art photo, the status line, the byte lens under the cursor
// and the lazily resolving section labels. No dependencies.
(function () {
  "use strict";

  const root = document.documentElement;
  if (!root.hasAttribute("data-style")) return; // the head script did not run: stay in the src view

  // Same keys as in _includes/head.liquid: the switch is remembered, a ?bin or ?src link is not.
  const CHOICE_KEY = "style-choice"; // localStorage: set by the switch
  const VISIT_KEY = "style-visit"; // sessionStorage: set by a ?bin / ?src link, for this tab only
  // Canvas colors for the byte lens, matching $bin-frost and $bin-coral in _sass/_bin.scss.
  const FROST = "143, 214, 255";
  const CORAL = "255, 107, 87";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
  const printing = window.matchMedia("print"); // paper gets the src design, so nothing animates for it

  const isBin = () => root.getAttribute("data-style") === "bin";
  const toHex = (n) => (n < 16 ? "0" : "") + n.toString(16);
  const utf8 = (text) => Array.from(new TextEncoder().encode(text));
  const printable = (byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : ".");

  // --- The name starts as its bytes and resolves into letters --------------------------------

  const FLUX = "#$%&*+<=>?@[]{}0123456789ABCDEFGHKMNRSTXZ"; // candidates a cell flickers through
  const CELL_STAGGER = 75; // ms between neighboring cells
  const FLUX_STEP = 45; // ms per candidate
  const FLUX_STEPS = 3;
  let nameRun = null;

  // Runs the callback once the display font is in (or after a short wait), so the name's cells
  // do not change width in the middle of the animation.
  const whenFontReady = (callback) => {
    let called = false;
    const once = () => {
      if (called) return;
      called = true;
      callback();
    };
    if (!document.fonts || !document.fonts.load) {
      once();
      return;
    }
    document.fonts.load('600 1em "IBM Plex Mono"').then(once, once);
    setTimeout(once, 500);
  };

  const stopName = () => {
    if (!nameRun) return;
    cancelAnimationFrame(nameRun.raf);
    nameRun.h1.textContent = nameRun.text; // back to plain text: the cells were only scaffolding
    nameRun.h1.removeAttribute("aria-label");
    nameRun = null;
  };

  const decodeName = (hold) => {
    const h1 = document.querySelector(".intro-name");
    if (!h1 || reducedMotion.matches || printing.matches) return;
    stopName();

    const text = h1.textContent.trim();
    const cells = Array.from(text).map((ch) => {
      const el = document.createElement("span");
      el.className = "bin-cell";
      el.setAttribute("aria-hidden", "true");
      const hex = document.createElement("span");
      hex.className = "bin-hex";
      hex.textContent = toHex(utf8(ch)[0]);
      el.appendChild(hex);
      return { el: el, ch: ch, blank: !ch.trim(), step: -1 };
    });

    h1.setAttribute("aria-label", text);
    h1.textContent = "";
    cells.forEach((cell) => h1.appendChild(cell.el));

    const run = { h1: h1, text: text, raf: 0 };
    nameRun = run;
    const start = performance.now() + hold;

    const tick = (now) => {
      let pending = false;
      cells.forEach((cell, i) => {
        if (cell.step >= FLUX_STEPS) return;
        const step = Math.floor((now - start - i * CELL_STAGGER) / FLUX_STEP);
        if (step < FLUX_STEPS) pending = true;
        if (step < 0 || step === cell.step) return;
        cell.step = step;
        if (step >= FLUX_STEPS) {
          cell.el.className = "bin-cell";
          cell.el.textContent = cell.blank ? "\u00a0" : cell.ch;
        } else if (!cell.blank) {
          cell.el.className = "bin-cell bin-cell-flux";
          cell.el.textContent = FLUX[Math.floor(Math.random() * FLUX.length)];
        }
      });
      if (pending) run.raf = requestAnimationFrame(tick);
      else stopName();
    };
    run.raf = requestAnimationFrame(tick);
  };

  // --- The photo as a pixel-art portrait; hovering or clicking it brings the original back -----
  // The photo is averaged down to a small grid, its colors reduced to a palette picked from the
  // picture itself, and the result tidied the way pixel art is cleaned up by hand.

  const PIXEL_GRID = 70; // blocks across, give or take: each block is a whole number of CSS pixels
  const PIXEL_COLORS = 12;
  const PIXEL_OVERSAMPLE = 4; // the photo is drawn this many times larger, then box-averaged down
  let photoRefresh = null; // set once the photo is wired up; redraws it if its size changed

  const luminance = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

  // Visits the up-to-eight neighbors of cell i on a cols x rows grid.
  const eachNeighbor = (i, cols, rows, visit) => {
    const x = i % cols;
    const y = (i - x) / cols;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx || dy) && x + dx >= 0 && x + dx < cols && y + dy >= 0 && y + dy < rows) visit(i + dy * cols + dx);
      }
    }
  };

  const pixelatePhoto = (img) => {
    const figure = img.closest("figure");
    if (!figure || !img.clientWidth || !img.clientHeight || !img.naturalWidth) return;
    const block = Math.max(2, Math.round(img.clientWidth / PIXEL_GRID));
    const cols = Math.round(img.clientWidth / block);
    const rows = Math.round(img.clientHeight / block);
    const count = cols * rows;

    let canvas = figure.querySelector(".bin-pixels");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "bin-pixels";
      canvas.setAttribute("aria-hidden", "true");
      figure.appendChild(canvas);
    } else if (canvas.width === cols && canvas.height === rows) {
      return; // already drawn on this grid
    }
    canvas.width = cols; // one canvas pixel per block; the stylesheet scales it up unsmoothed
    canvas.height = rows;

    // 1. Average the photo down to the grid.
    const work = document.createElement("canvas");
    work.width = cols * PIXEL_OVERSAMPLE;
    work.height = rows * PIXEL_OVERSAMPLE;
    let source;
    try {
      const workCtx = work.getContext("2d");
      workCtx.imageSmoothingQuality = "high";
      workCtx.drawImage(img, 0, 0, work.width, work.height);
      source = workCtx.getImageData(0, 0, work.width, work.height).data;
    } catch (e) {
      canvas.remove(); // a cross-origin photo cannot be read back: keep the plain one
      return;
    }
    let cells = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x0 = (i % cols) * PIXEL_OVERSAMPLE;
      const y0 = Math.floor(i / cols) * PIXEL_OVERSAMPLE;
      for (let dy = 0; dy < PIXEL_OVERSAMPLE; dy++) {
        for (let dx = 0; dx < PIXEL_OVERSAMPLE; dx++) {
          const at = 4 * ((y0 + dy) * work.width + x0 + dx);
          cells[3 * i] += source[at];
          cells[3 * i + 1] += source[at + 1];
          cells[3 * i + 2] += source[at + 2];
        }
      }
    }
    const samples = PIXEL_OVERSAMPLE * PIXEL_OVERSAMPLE;

    // 2. Tone: stretch between the 1st and 99th percentile, then a little more contrast and color,
    //    so the palette is spent on a picture that already reads clearly.
    const lums = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) cells[3 * i + c] /= samples;
      lums[i] = luminance(cells[3 * i], cells[3 * i + 1], cells[3 * i + 2]);
    }
    const sorted = Float32Array.from(lums).sort();
    const low = sorted[Math.floor(count * 0.01)];
    const range = Math.max(1, sorted[Math.floor(count * 0.99)] - low);
    for (let i = 0; i < count; i++) {
      const rgb = [0, 1, 2].map((c) => 128 + (((cells[3 * i + c] - low) / range) * 255 - 128) * 1.1);
      const gray = luminance(rgb[0], rgb[1], rgb[2]);
      for (let c = 0; c < 3; c++) cells[3 * i + c] = Math.min(255, Math.max(0, gray + (rgb[c] - gray) * 1.25));
    }

    // 3. Flatten low-contrast texture (a studio backdrop, skin) without touching real edges:
    //    each cell becomes the mean of itself and the neighbors that are close to it in color.
    for (let pass = 0; pass < 2; pass++) {
      const next = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        let r = cells[3 * i];
        let g = cells[3 * i + 1];
        let b = cells[3 * i + 2];
        let n = 1;
        eachNeighbor(i, cols, rows, (j) => {
          const distance =
            Math.abs(cells[3 * j] - cells[3 * i]) + Math.abs(cells[3 * j + 1] - cells[3 * i + 1]) + Math.abs(cells[3 * j + 2] - cells[3 * i + 2]);
          if (distance < 40) {
            r += cells[3 * j];
            g += cells[3 * j + 1];
            b += cells[3 * j + 2];
            n++;
          }
        });
        next[3 * i] = r / n;
        next[3 * i + 1] = g / n;
        next[3 * i + 2] = b / n;
      }
      cells = next;
    }

    // 4. Palette: k-means over the cells, started from evenly spaced luminance quantiles so the
    //    result is the same on every visit.
    const k = Math.min(PIXEL_COLORS, count);
    const byLuminance = Array.from({ length: count }, (_, i) => i).sort(
      (i, j) => luminance(cells[3 * i], cells[3 * i + 1], cells[3 * i + 2]) - luminance(cells[3 * j], cells[3 * j + 1], cells[3 * j + 2])
    );
    const palette = new Float32Array(k * 3);
    for (let j = 0; j < k; j++) {
      const seed = byLuminance[Math.floor(((j + 0.5) * count) / k)];
      for (let c = 0; c < 3; c++) palette[3 * j + c] = cells[3 * seed + c];
    }
    let index = new Uint8Array(count);
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < count; i++) {
        let best = 0;
        let bestDistance = Infinity;
        for (let j = 0; j < k; j++) {
          const dr = cells[3 * i] - palette[3 * j];
          const dg = cells[3 * i + 1] - palette[3 * j + 1];
          const db = cells[3 * i + 2] - palette[3 * j + 2];
          const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db; // roughly how the eye weighs the channels
          if (distance < bestDistance) {
            bestDistance = distance;
            best = j;
          }
        }
        index[i] = best;
      }
      const sums = new Float32Array(k * 4);
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < 3; c++) sums[4 * index[i] + c] += cells[3 * i + c];
        sums[4 * index[i] + 3]++;
      }
      for (let j = 0; j < k; j++) {
        if (!sums[4 * j + 3]) continue; // nothing landed on this color: leave it where it was
        for (let c = 0; c < 3; c++) palette[3 * j + c] = sums[4 * j + c] / sums[4 * j + 3];
      }
    }
    const paletteLuminance = (j) => luminance(palette[3 * j], palette[3 * j + 1], palette[3 * j + 2]);

    // 5. Orphans: a cell none of whose neighbors shares its color takes the color most of them
    //    have (the closest in brightness on a tie). Lines survive, stray specks do not.
    const tidy = Uint8Array.from(index);
    for (let i = 0; i < count; i++) {
      const votes = new Uint8Array(k);
      eachNeighbor(i, cols, rows, (j) => votes[index[j]]++);
      if (votes[index[i]]) continue;
      let pick = index[i];
      for (let j = 0; j < k; j++) {
        if (!votes[j]) continue;
        const closer = Math.abs(paletteLuminance(j) - paletteLuminance(index[i])) < Math.abs(paletteLuminance(pick) - paletteLuminance(index[i]));
        if (pick === index[i] || votes[j] > votes[pick] || (votes[j] === votes[pick] && closer)) pick = j;
      }
      tidy[i] = pick;
    }
    index = tidy;

    // 6. Paint one canvas pixel per cell.
    const ctx = canvas.getContext("2d");
    const pixels = ctx.createImageData(cols, rows);
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) pixels.data[4 * i + c] = Math.round(palette[3 * index[i] + c]);
      pixels.data[4 * i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    figure.classList.add("bin-pixelated");

    const caption = figure.parentNode.querySelector(".bin-caption");
    if (caption) {
      caption.textContent = cols + "\u00d7" + rows + " px \u00b7 " + k + " colors \u00b7 " + (finePointer.matches ? "hover" : "tap") + ": raw";
    }
  };

  const setupPhoto = () => {
    if (photoRefresh) {
      photoRefresh();
      return;
    }
    const img = document.querySelector(".intro-aside img.profile-photo");
    const figure = img && img.closest("figure");
    if (!figure) return;

    const caption = document.createElement("p"); // filled in once the portrait is drawn
    caption.className = "bin-only bin-caption";
    caption.setAttribute("aria-hidden", "true");
    figure.insertAdjacentElement("afterend", caption);
    // A click (or tap, where there is no hover) pins the original until the next one.
    figure.addEventListener("click", () => {
      if (isBin()) figure.classList.toggle("bin-reveal");
    });

    photoRefresh = () => {
      if (isBin() && img.complete) pixelatePhoto(img);
    };
    img.addEventListener("load", photoRefresh);
    if (window.ResizeObserver) new ResizeObserver(photoRefresh).observe(img);
    photoRefresh();
  };

  // --- Status line: the bytes of the word under the cursor, and where you are as <symbol+offset>

  const PROBE_BYTES = 16;
  let status = null;

  const slug = (text) => text.trim().toLowerCase().replace(/\s+/g, "_");

  // The page's "symbols": the intro is <_start>, every section with an id is named after it.
  const findSymbols = () => {
    const symbols = [];
    const intro = document.querySelector(".intro");
    const title = document.querySelector(".post-title");
    const main = document.querySelector("main");
    if (intro) symbols.push({ name: "_start", el: intro });
    else if (main) symbols.push({ name: title ? slug(title.textContent) : "main", el: main });
    document.querySelectorAll("main section[id]").forEach((el) => symbols.push({ name: el.id, el: el }));
    return symbols;
  };

  // The whole word under a viewport point, or "" when the pointer is not on text.
  const wordAt = (x, y) => {
    if (y >= status.bar.getBoundingClientRect().top) return ""; // over the status line itself
    let node = null;
    let offset = 0;
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        node = position.offsetNode;
        offset = position.offset;
      }
    } else if (document.caretRangeFromPoint) {
      const caret = document.caretRangeFromPoint(x, y);
      if (caret) {
        node = caret.startContainer;
        offset = caret.startOffset;
      }
    }
    if (!node || node.nodeType !== Node.TEXT_NODE) return "";

    const text = node.data;
    let from = offset;
    let to = offset;
    while (from > 0 && /\S/.test(text[from - 1])) from--;
    while (to < text.length && /\S/.test(text[to])) to++;
    if (from === to) return "";

    // The caret snaps to the nearest text, so check the pointer really is on this word.
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const hit = Array.from(range.getClientRects()).some(
      (rect) => x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1
    );
    if (!hit) return "";
    let word = text.slice(from, to).replace(/^[.,;:!?()"'\u2018\u2019\u201c\u201d*]+|[.,;:!?()"'\u2018\u2019\u201c\u201d*]+$/g, "");
    // Report the bytes of what is on screen: the bin view lowercases the header and the labels.
    const transform = node.parentElement ? getComputedStyle(node.parentElement).textTransform : "none";
    if (transform === "lowercase") word = word.toLowerCase();
    else if (transform === "uppercase") word = word.toUpperCase();
    return word;
  };

  // A word the way a hex editor shows it: its bytes, then the printable characters.
  const describeWord = (word) => {
    if (!word) return "";
    const bytes = utf8(word);
    const shown = bytes.slice(0, PROBE_BYTES);
    return shown.map(toHex).join(" ") + (bytes.length > PROBE_BYTES ? " \u2026" : "") + "  |" + shown.map(printable).join("") + "|";
  };

  const showProbe = (text) => {
    if (!status || text === status.shown) return;
    status.shown = text;
    status.probe.textContent = text || status.hint;
    status.probe.className = text ? "bin-status-probe bin-status-live" : "bin-status-probe";
  };

  const updatePosition = () => {
    if (!status) return;
    status.scrollQueued = false;
    const scrollY = window.scrollY;
    const scrollable = root.scrollHeight - window.innerHeight;
    // The reading line sits a third of the way down the window and glides to its bottom edge over
    // the last stretch of the page; otherwise a short final section could never be reached.
    const tail = Math.min(scrollable, window.innerHeight * 0.7);
    const glide = tail > 0 ? Math.max(0, (scrollY - (scrollable - tail)) / tail) : 0;
    const line = scrollY + window.innerHeight * (0.3 + 0.7 * Math.min(1, glide));
    let current = status.symbols[0];
    let currentTop = 0;
    status.symbols.forEach((symbol) => {
      const top = symbol.el.getBoundingClientRect().top + scrollY;
      if (symbol === status.symbols[0] || top <= line) {
        current = symbol;
        currentTop = top;
      }
    });
    const offset = Math.max(0, Math.round(line - currentTop));
    status.sym.textContent = current ? "<" + current.name + "+0x" + offset.toString(16) + ">" : "";
    status.pct.textContent = (scrollable > 0 ? Math.round(Math.min(1, Math.max(0, scrollY / scrollable)) * 100) : 100) + "%";
  };

  const onStatusScroll = () => {
    if (!status || status.scrollQueued) return;
    status.scrollQueued = true;
    requestAnimationFrame(updatePosition);
  };

  const onStatusPointer = (event) => {
    if (!status || status.pointerQueued) return;
    status.pointerQueued = true;
    requestAnimationFrame(() => {
      if (!status) return;
      status.pointerQueued = false;
      // Something that explains itself (data-note, like the header fields) is read out as written;
      // anything else gets the bytes of the word under the pointer.
      const noted = event.target instanceof Element ? event.target.closest("[data-note]") : null;
      showProbe(noted ? noted.getAttribute("data-note") : describeWord(wordAt(event.clientX, event.clientY)));
    });
  };

  const startStatus = () => {
    if (status) return;
    const bar = document.createElement("div");
    bar.className = "bin-status";
    bar.setAttribute("aria-hidden", "true");
    const part = (className, text) => {
      const el = document.createElement("span");
      el.className = className;
      el.textContent = text || "";
      bar.appendChild(el);
      return el;
    };
    part("bin-status-mode", "bin");
    part("bin-status-path", location.host + location.pathname);
    status = {
      bar: bar,
      hint: finePointer.matches ? "hover a word to read its bytes" : "",
      shown: null,
      probe: part("bin-status-probe"),
      sym: part("bin-status-sym"),
      pct: part("bin-status-pct"),
      symbols: findSymbols(),
      scrollQueued: false,
      pointerQueued: false,
    };
    showProbe("");
    document.body.appendChild(bar);
    updatePosition();
    window.addEventListener("scroll", onStatusScroll, { passive: true });
    window.addEventListener("resize", onStatusScroll, { passive: true });
    if (finePointer.matches) document.addEventListener("pointermove", onStatusPointer, { passive: true });
  };

  const stopStatus = () => {
    if (!status) return;
    window.removeEventListener("scroll", onStatusScroll);
    window.removeEventListener("resize", onStatusScroll);
    document.removeEventListener("pointermove", onStatusPointer);
    status.bar.remove();
    status = null;
  };

  // --- Byte lens: the cursor lights up the bytes under the page; its center decodes them ------
  // The bytes are the site description (the <meta name="description"> text), laid out on a grid
  // that scrolls with the document, so the same spot always holds the same byte.

  const CELL_W = 22;
  const CELL_H = 17;
  const LENS_RADIUS = 170;
  const LENS_CORE = 46; // inside this radius bytes are shown decoded
  const LENS_IDLE = 1400; // ms without movement before the lens fades out
  let lens = null;

  const sizeLens = () => {
    if (!lens) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    lens.width = window.innerWidth;
    lens.height = window.innerHeight;
    lens.cols = Math.max(1, Math.ceil(lens.width / CELL_W));
    const column = document.querySelector("main");
    const bounds = column ? column.getBoundingClientRect() : { left: 0, right: 0 };
    lens.columnLeft = bounds.left;
    lens.columnRight = bounds.right;
    lens.canvas.width = Math.round(lens.width * dpr);
    lens.canvas.height = Math.round(lens.height * dpr);
    lens.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lens.ctx.textAlign = "center";
    lens.ctx.textBaseline = "middle";
  };

  const drawLens = () => {
    if (!lens) return;
    const l = lens;
    const ctx = l.ctx;
    l.raf = 0;
    l.x += (l.targetX - l.x) * 0.22;
    l.y += (l.targetY - l.y) * 0.22;
    l.glow += (l.targetGlow - l.glow) * (l.targetGlow > l.glow ? 0.2 : 0.07);
    ctx.clearRect(0, 0, l.width, l.height);

    if (l.glow > 0.01) {
      const scrollY = window.scrollY;
      const count = l.bytes.length;
      const colFrom = Math.max(0, Math.floor((l.x - LENS_RADIUS) / CELL_W));
      const colTo = Math.min(l.cols - 1, Math.floor((l.x + LENS_RADIUS) / CELL_W));
      const rowFrom = Math.max(0, Math.floor((l.y + scrollY - LENS_RADIUS) / CELL_H));
      const rowTo = Math.floor((l.y + scrollY + LENS_RADIUS) / CELL_H);
      const decoded = [];

      ctx.font = '11px "IBM Plex Mono", ui-monospace, Menlo, monospace';
      for (let row = rowFrom; row <= rowTo; row++) {
        for (let col = colFrom; col <= colTo; col++) {
          const cx = col * CELL_W + CELL_W / 2;
          const cy = row * CELL_H + CELL_H / 2 - scrollY;
          const distance = Math.hypot(cx - l.x, cy - l.y);
          if (distance > LENS_RADIUS) continue;
          const byte = l.bytes[(row * l.cols + col) % count];
          // Under the text column the bytes stay faint and undecoded, so reading is never disturbed.
          const underText = cx > l.columnLeft && cx < l.columnRight;
          if (distance < LENS_CORE && !underText) {
            decoded.push([printable(byte), cx, cy, 1 - 0.55 * (distance / LENS_CORE)]);
          } else {
            const falloff = Math.pow(Math.max(0, 1 - (distance - LENS_CORE) / (LENS_RADIUS - LENS_CORE)), 1.4);
            const alpha = (underText ? 0.13 : 0.42) * Math.min(1, falloff) * l.glow;
            ctx.fillStyle = "rgba(" + FROST + ", " + alpha.toFixed(3) + ")";
            ctx.fillText(toHex(byte), cx, cy);
          }
        }
      }
      ctx.font = '600 13px "IBM Plex Mono", ui-monospace, Menlo, monospace';
      decoded.forEach((cell) => {
        ctx.fillStyle = "rgba(" + CORAL + ", " + (0.9 * cell[3] * l.glow).toFixed(3) + ")";
        ctx.fillText(cell[0], cell[1], cell[2]);
      });
    }

    const moving = Math.abs(l.targetX - l.x) > 0.3 || Math.abs(l.targetY - l.y) > 0.3;
    if (moving || Math.abs(l.targetGlow - l.glow) > 0.005) l.raf = requestAnimationFrame(drawLens);
  };

  const kickLens = () => {
    if (lens && !lens.raf) lens.raf = requestAnimationFrame(drawLens);
  };

  const fadeLens = () => {
    if (!lens) return;
    lens.targetGlow = 0;
    kickLens();
  };

  const onLensPointer = (event) => {
    if (!lens || event.pointerType === "touch") return;
    if (lens.glow < 0.02) {
      lens.x = event.clientX; // waking up: appear at the pointer instead of gliding in from afar
      lens.y = event.clientY;
    }
    lens.targetX = event.clientX;
    lens.targetY = event.clientY;
    // Over the header block the lens goes dark: its bytes would only get in the way of those.
    lens.targetGlow = event.target instanceof Element && event.target.closest(".bin-listing") ? 0 : 1;
    clearTimeout(lens.idle);
    lens.idle = setTimeout(fadeLens, LENS_IDLE);
    kickLens();
  };

  const startLens = () => {
    if (lens || !finePointer.matches || reducedMotion.matches) return;
    const meta = document.querySelector('meta[name="description"]');
    const text = ((meta && meta.getAttribute("content")) || document.title || "").trim();
    if (!text) return;
    const canvas = document.createElement("canvas");
    canvas.className = "bin-lens";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    lens = {
      canvas: canvas,
      ctx: canvas.getContext("2d"),
      bytes: utf8(text + " "),
      x: 0,
      y: 0,
      targetX: 0,
      targetY: 0,
      glow: 0,
      targetGlow: 0,
      raf: 0,
      idle: 0,
      width: 0,
      height: 0,
      cols: 1,
      columnLeft: 0,
      columnRight: 0,
    };
    sizeLens();
    document.addEventListener("pointermove", onLensPointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", fadeLens);
    window.addEventListener("scroll", kickLens, { passive: true });
    window.addEventListener("resize", sizeLens, { passive: true });
  };

  const stopLens = () => {
    if (!lens) return;
    document.removeEventListener("pointermove", onLensPointer);
    document.documentElement.removeEventListener("pointerleave", fadeLens);
    window.removeEventListener("scroll", kickLens);
    window.removeEventListener("resize", sizeLens);
    cancelAnimationFrame(lens.raf);
    clearTimeout(lens.idle);
    lens.canvas.remove();
    lens = null;
  };

  // --- The ELF header above the name: read out once on load, then linked on hover --------------
  // The layout prints 32 header bytes, the line file(1) derives from them and the entry label.
  // Elements with the same data-f belong to one field (its bytes and the words they produce);
  // data-p marks punctuation that appears along with a field.

  const HEADER_STEP = 55; // ms per field while the header is read out
  const NAME_LAG = 330; // the name starts to resolve as the read-out reaches the entry point
  let listing = null;
  let headerTimers = [];

  // Marks one field hot wherever it appears (or none); `aside` makes the other fields step back.
  const heatField = (name, aside) => {
    if (!listing) return;
    listing.querySelectorAll(".bin-hot").forEach((el) => el.classList.remove("bin-hot"));
    if (name) listing.querySelectorAll('[data-f="' + name + '"]').forEach((el) => el.classList.add("bin-hot"));
    listing.classList.toggle("bin-linking", Boolean(name && aside));
  };

  const stopHeader = () => {
    headerTimers.forEach(clearTimeout);
    headerTimers = [];
    if (!listing) return;
    listing.classList.remove("bin-parsing");
    listing.querySelectorAll(".bin-read").forEach((el) => el.classList.remove("bin-read"));
    heatField(null);
  };

  const readHeader = (hold) => {
    if (!listing || reducedMotion.matches || printing.matches) return;
    stopHeader();
    const fields = []; // in file order, which is the order they first appear in the markup
    listing.querySelectorAll("[data-f]").forEach((el) => {
      const name = el.getAttribute("data-f");
      if (fields.indexOf(name) < 0) fields.push(name);
    });
    listing.classList.add("bin-parsing"); // hides what has not been read yet
    fields.forEach((name, i) => {
      const read = () => {
        heatField(name, false);
        listing.querySelectorAll('[data-f="' + name + '"], [data-p="' + name + '"]').forEach((el) => el.classList.add("bin-read"));
      };
      headerTimers.push(setTimeout(read, hold + i * HEADER_STEP));
    });
    headerTimers.push(setTimeout(stopHeader, hold + fields.length * HEADER_STEP + 140));
  };

  const setupHeader = () => {
    if (listing) return;
    listing = document.querySelector(".bin-listing");
    if (!listing) return;
    listing.addEventListener("pointerover", (event) => {
      if (listing.classList.contains("bin-parsing")) return; // let the read-out finish first
      const field = event.target.closest("[data-f]");
      heatField(field ? field.getAttribute("data-f") : null, true);
    });
    listing.addEventListener("pointerleave", () => {
      if (!listing.classList.contains("bin-parsing")) heatField(null);
    });
  };

  // --- Section labels resolve the first time they scroll into view, like lazily bound symbols --

  const LABEL_STEP = 28; // ms for each further character to settle
  const labelRuns = new Set(); // labels in mid-flight; calling an entry settles that label at once
  let labelObserver = null;

  const resolveLabel = (el) => {
    if (printing.matches) return;
    const text = el.textContent;
    const chars = Array.from(text);
    const start = performance.now();
    let raf = 0;
    const settle = () => {
      cancelAnimationFrame(raf);
      el.textContent = text;
      el.removeAttribute("aria-label");
      labelRuns.delete(settle);
    };
    const tick = (now) => {
      const settled = Math.floor((now - start) / LABEL_STEP);
      if (settled >= chars.length) {
        settle();
        return;
      }
      el.textContent = chars.map((ch, i) => (i < settled || !ch.trim() ? ch : FLUX[Math.floor(Math.random() * FLUX.length)])).join("");
      raf = requestAnimationFrame(tick);
    };
    labelRuns.add(settle);
    el.setAttribute("aria-label", text);
    raf = requestAnimationFrame(tick);
  };

  const startLabels = () => {
    if (labelObserver || reducedMotion.matches || !window.IntersectionObserver) return;
    labelObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          observer.unobserve(entry.target);
          resolveLabel(entry.target);
        });
      },
      { threshold: 1, rootMargin: "0px 0px -12% 0px" } // fully in view and clear of the bottom edge
    );
    document.querySelectorAll(".section-heading, .post-title").forEach((el) => {
      if (!el.children.length) labelObserver.observe(el); // plain-text labels only
    });
  };

  const stopLabels = () => {
    labelRuns.forEach((settle) => settle());
    if (!labelObserver) return;
    labelObserver.disconnect();
    labelObserver = null;
  };

  // Printing in the middle of an animation must not put half-decoded text on paper.
  window.addEventListener("beforeprint", () => {
    stopName();
    labelRuns.forEach((settle) => settle());
  });

  // --- Entering, leaving, and the src | bin switch -------------------------------------------

  const toggle = document.getElementById("style-toggle");

  const enterBin = (hold) => {
    setupHeader();
    whenFontReady(() => {
      if (isBin()) {
        readHeader(hold);
        decodeName(listing ? hold + NAME_LAG : hold);
      }
      root.classList.add("bin-live"); // un-hides the name and the header's meaning, now that both are staged
    });
    setupPhoto();
    startStatus();
    startLens();
    startLabels();
  };

  const leaveBin = () => {
    stopHeader();
    stopName();
    stopStatus();
    stopLens();
    stopLabels();
  };

  const apply = (style, hold) => {
    root.setAttribute("data-style", style);
    try {
      localStorage.setItem(CHOICE_KEY, style);
      sessionStorage.removeItem(VISIT_KEY); // the switch overrules the link this visit came in on
    } catch (e) {
      // storage unavailable (private mode): the choice just lasts for this page
    }
    if (toggle) toggle.setAttribute("aria-checked", style === "bin" ? "true" : "false");
    if (style === "bin") enterBin(hold);
    else leaveBin();
  };

  // Swap views behind a scan line that wipes down the page (View Transitions, where supported).
  let switching = false;

  const switchTo = (style) => {
    if (switching) return; // a wipe is already on its way down
    if (!document.startViewTransition || reducedMotion.matches) {
      apply(style, 0);
      return;
    }
    switching = true;
    const line = document.createElement("div");
    line.className = "bin-scanline";
    document.body.appendChild(line);
    root.classList.add("bin-switching");
    const cleanUp = () => {
      switching = false;
      root.classList.remove("bin-switching");
      line.remove();
    };
    const transition = document.startViewTransition(() => {
      apply(style, 350); // hold the bytes until the wipe has passed the name
      line.classList.add("bin-scanline-end");
    });
    transition.finished.then(cleanUp, cleanUp);
  };

  if (toggle) {
    toggle.setAttribute("aria-checked", isBin() ? "true" : "false");
    toggle.addEventListener("click", () => switchTo(isBin() ? "src" : "bin"));
  }
  if (isBin()) enterBin(150);
})();
