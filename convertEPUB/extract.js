import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Edit these paths to choose the input and output.
const INPUT_FILE = String.raw`D:\Code\Youtube_WorkSpace\cawl\convertEPUB\Epub\Sư Huynh Của Ta Quá Mạnh - Khả Ninh.epub`;
const OUTPUT_DIR = "D:/Code/TTS/cawl/convertEPUB/output";
const clean = text => text.normalize('NFC').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const compact = text => clean(text).replace(/\s+/g, ' ');
// Remove recognizable ebook/site boilerplate, including inline watermarks.
// Never drop a whole narrative paragraph merely because it contains a URL.
const site = String.raw`(?:T\s*r\s*u\s*y\s*[eệê]\s*n\s*y\s*y|EbookTruyen|truyencuat[ｕu]i)(?:\s*\[?\.?\]?\s*(?:c\s*o\s*m|net|vn))?\/?`;
const boilerplate = [
  new RegExp(String.raw`Truyện\s+được\s+(?:đăng|copy|đăng tải)\s+(?:tại|ở|trên)\s+(?:https?:\/\/)?${site}`, 'giu'),
  new RegExp(String.raw`(?:Bạn\s+đang\s+(?:đọc|xem)\s+truyện\s+(?:tại|ở)|[Đđ]ọc\s+truyện\s+(?:tại|với)\s*[❤♥]?)\s*(?:https?:\/\/)?${site}`, 'giu'),
  /(?:Đăng\s+nhập|g\s+n[ｈh]ập)\s+https?:\/\/[^\s]+\s+đ[ọǫo]c\s+truyện/giu,
  /https?:\/\/[^\s<>]+/giu,
  /^(?:Nguồn|Dịch giả|Biên dịch|Biên tập|Convert|Converter|Ebook tạo bởi)\s*:[^\n]*$/gimu,
  /^\s*(?:Quyển\s*\d+\s*:[^\n]*|(?:Dịch|Nhóm dịch)\s*:[^\n]*)\s*$/gimu,
  /^\s*(?:Chương\s*(?:thứ\s+)?\d[^\n]*|[-–—_=*\s]*(?:oOo|\*\s*\*\s*\*)[-–—_=*\s]*)\s*$/gimu,
];
export function storyContent(text) {
  let content = text;
  for (const pattern of boilerplate) content = content.replace(pattern, '');
  const noteNumbers = new Set();
  const paragraphs = clean(content).split(/\n{2,}/);
  content = paragraphs.filter(paragraph => {
    const note = paragraph.match(/^\s*(?:\((\d+)\)|\[(\d+)\])\s*[:：.\-–]?\s+\S/u)
      || paragraph.match(/^\s*(?:\((\d+)\)|\[(\d+)\])\s*[:：]\s*\S/u);
    if (note) { noteNumbers.add(note[1] || note[2]); return false; }
    return !/^\s*(?:Chú thích|Chú giải|Dịch chú|Ghi chú của (?:dịch giả|người dịch)|Lời (?:dịch giả|người dịch)|Nhóm dịch)\s*[:：]/iu.test(paragraph);
  }).join('\n\n');
  // Only erase numeric references whose annotation was identified above.
  // Parenthesized numbers belonging to the story remain intact.
  content = content.replace(/\((\d+)\)|\[(\d+)\]/gu, (marker, round, square) => noteNumbers.has(round || square) ? '' : marker);
  content = content.replace(/[ \t]+([,.;:!?])/g, '$1');
  content = clean(content);
  return content ? `${content}\n` : '';
}
export function stripChapterTitle(text, title) {
  const pattern = compact(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  const heading = new RegExp(`^${pattern}(?=\\s|$)`, 'u');
  if (!heading.test(text)) throw new Error(`Không tìm thấy tiêu đề đầu chương: ${title}`);
  const body = clean(text.replace(heading, ''));
  return body ? `${body}\n` : '';
}
const chapterNumber = title => {
  const match = compact(title).match(/^Chương\s*(?:thứ\s+)?(\d(?:[\d ]*\d)?)(?=\s*[:.\-–]|\s|$)/iu);
  return match ? Number(match[1].replace(/ /g, '')) : null;
};

function reference(base, href) {
  const hash = href.indexOf('#');
  const file = hash < 0 ? href : href.slice(0, hash);
  const anchor = hash < 0 ? '' : decodeURIComponent(href.slice(hash + 1));
  const target = file ? path.posix.normalize(path.posix.join(path.posix.dirname(base), decodeURIComponent(file))) : base;
  if (target.startsWith('../') || target.startsWith('/') || /^[a-z]+:/i.test(target)) throw new Error(`Liên kết không hợp lệ: ${href}`);
  return { file: target, anchor, key: `${target}#${anchor}` };
}

/** Read spine order and resolve TOC anchors against a single text stream.
 * Never slice by HTML filename: chapters may span files or share a file.
 */
export function extractEpub(zip) {
  const read = name => {
    const entry = zip.getEntry(name);
    if (!entry) throw new Error(`EPUB thiếu file: ${name}`);
    return zip.readAsText(entry, 'utf8');
  };
  const container = load(read('META-INF/container.xml'), { xmlMode: true });
  const opfFile = container('rootfile').first().attr('full-path');
  if (!opfFile) throw new Error('Không tìm thấy package OPF.');
  const opf = load(read(opfFile), { xmlMode: true });
  const manifest = new Map();
  opf('manifest > item').each((_, node) => {
    const el = opf(node);
    manifest.set(el.attr('id'), { file: reference(opfFile, el.attr('href')).file, type: el.attr('media-type'), properties: el.attr('properties') || '' });
  });
  const spine = [];
  opf('spine > itemref').each((_, node) => {
    const item = manifest.get(opf(node).attr('idref'));
    if (!item) throw new Error('Spine tham chiếu tới item không tồn tại.');
    if (['application/xhtml+xml', 'text/html'].includes(item.type)) spine.push(item.file);
  });
  if (!spine.length) throw new Error('EPUB không có nội dung HTML trong spine.');
  const documents = spine.map(file => ({ file, $: load(read(file)) }));
  const visible = [];
  for (const { file, $ } of documents) {
    $('.chapter_link a[href]').each((_, node) => visible.push({ title: compact($(node).text()), ...reference(file, $(node).attr('href')) }));
  }
  const htmlLinks = [];
  for (const { file, $ } of documents) {
    $('a[href]').each((_, node) => {
      const title = compact($(node).text());
      if (chapterNumber(title) !== null) htmlLinks.push({ title, ...reference(file, $(node).attr('href')) });
    });
  }
  const candidates = [visible, htmlLinks];
  for (const item of manifest.values()) {
    if (item.properties.split(/\s+/).includes('nav')) {
      const $ = load(read(item.file));
      const entries = [];
      $('nav').filter((_, node) => ($(node).attr('epub:type') || '').split(/\s+/).includes('toc')).find('a[href]').each((_, node) => entries.push({ title: compact($(node).text()), ...reference(item.file, $(node).attr('href')) }));
      candidates.push(entries);
    }
    if (item.type === 'application/x-dtbncx+xml') {
      const $ = load(read(item.file), { xmlMode: true });
      const entries = [];
      $('navPoint').each((_, node) => {
        const href = $(node).children('content').attr('src');
        if (href) entries.push({ title: compact($(node).children('navLabel').text()), ...reference(item.file, href) });
      });
      candidates.push(entries);
    }
  }
  const numberedCandidates = candidates.map(entries => entries.filter(e => chapterNumber(e.title) !== null));
  // Named chapters may omit "Chương N" completely; chap_N.xhtml plus its
  // visible h1 provides a concrete boundary without relying on label text.
  const fileChapters = [];
  for (const { file, $ } of documents) {
    const match = path.posix.basename(file).match(/^chap_(\d+)\.x?html$/i);
    const heading = $('body h1').first();
    if (match && heading.length && $('p').toArray().some(node => compact($(node).text()))) {
      fileChapters.push({ title: compact(heading.text()), sourceNumber: Number(match[1]), ...reference(file, '') });
      $('.sigil_not_in_toc').filter((_, node) => $(node).find('a[href^="http"]').length > 0).remove();
    }
  }
  const toc = [...numberedCandidates, fileChapters].sort((a, b) => b.length - a.length)[0];
  if (!toc?.length) throw new Error('Không tìm thấy mục lục chương có số.');
  const keys = new Set(), numbers = new Set(), duplicateNumbers = new Set();
  for (const entry of toc) {
    entry.sourceNumber ??= chapterNumber(entry.title);
    if (keys.has(entry.key)) throw new Error(`Mục lục trùng điểm neo: ${entry.title}`);
    if (numbers.has(entry.sourceNumber)) duplicateNumbers.add(entry.sourceNumber);
    keys.add(entry.key); numbers.add(entry.sourceNumber);
  }
  const missingNumbers = [];
  const anomalousSourceNumbers = [...numbers].filter(n => n > toc.length * 2);
  const plausibleNumbers = [...numbers].filter(n => n <= toc.length * 2);
  for (let n = 1; n <= Math.max(0, ...plausibleNumbers); n++) if (!numbers.has(n)) missingNumbers.push(n);
  const numberingMode = duplicateNumbers.size || missingNumbers.length || anomalousSourceNumbers.length || toc.some((entry, i) => i && entry.sourceNumber !== toc[i - 1].sourceNumber + 1) ? 'toc-order' : 'source-number';
  toc.forEach((entry, i) => { entry.number = numberingMode === 'toc-order' ? i + 1 : entry.sourceNumber; });

  // Some EPUBs split the chapter label and subtitle into separate elements.
  // Canonicalize only when both agree with the TOC, before extracting text.
  for (const entry of toc) {
    if (entry.anchor) continue;
    const doc = documents.find(d => d.file === entry.file);
    if (!doc) continue;
    const { $ } = doc;
    const label = $('.chuong').first();
    const subtitle = $('h1, h2, h3, h4, h5, h6').first();
    if (label.length && subtitle.length) {
      const combined = `${compact(label.text())}: ${compact(subtitle.text())}`;
      if (combined !== entry.title) throw new Error(`Tiêu đề tách dòng không khớp mục lục: ${entry.title} (${combined})`);
      label.text(entry.title);
      subtitle.remove();
      $('.header, .author, author').remove();
    }
  }

  const chunks = [], offsets = new Map(), headings = [];
  let length = 0;
  const append = text => { chunks.push(text); length += text.length; };
  const blocks = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'tr']);
  for (const { file, $ } of documents) {
    offsets.set(`${file}#`, length);
    // Volume TOC pages between chapters must not become narrative content.
    if ($('a[href]').toArray().some(node => chapterNumber($(node).text()) !== null) && !$('p').toArray().some(node => compact($(node).text()))) continue;
    function walk(node) {
      if (node.type === 'text') {
        // Whitespace-only HTML indentation must not become a new paragraph.
        if (/\S/u.test(node.data)) append(node.data.replace(/\s+/gu, ' '));
        else if (!/[\r\n]/.test(node.data)) append(' ');
        return;
      }
      if (!node.name) return;
      const classes = (node.attribs?.class || '').split(/\s+/);
      const epubTypes = (node.attribs?.['epub:type'] || '').split(/\s+/);
      const role = node.attribs?.role;
      if (epubTypes.some(type => ['footnote', 'endnote', 'rearnote', 'noteref'].includes(type))
        || ['doc-footnote', 'doc-endnote', 'doc-noteref'].includes(role)
        || classes.some(c => ['footnote', 'footnotes', 'endnote', 'endnotes', 'noteref', 'translator-note', 'translation-note'].includes(c))) return;
      if (['script', 'style', 'nav', 'svg', 'footer', 'author'].includes(node.name) || classes.some(c => ['chapter_link', 'book_credit', 'book_author', 'book_title', 'book_summary_title', 'book_summary', 'book_cover', 'advertisement', 'ads', 'navigation', 'header', 'author'].includes(c))) return;
      for (const anchor of new Set([node.attribs?.id, node.name === 'a' ? node.attribs?.name : undefined].filter(Boolean))) {
        const key = `${file}#${anchor}`;
        if (offsets.has(key)) throw new Error(`Điểm neo trùng trong nội dung: ${key}`);
        offsets.set(key, length);
      }
      if (classes.includes('chapter_title')) headings.push(compact($(node).text()));
      if (node.name === 'br') { append('\n'); return; }
      if (blocks.has(node.name)) append('\n\n');
      for (const child of node.children || []) walk(child);
      if (blocks.has(node.name)) append('\n\n');
    }
    for (const node of $('body').get(0)?.children || []) walk(node);
    append('\n\n');
  }
  const stream = chunks.join('');
  const starts = toc.map(entry => {
    if (!offsets.has(entry.key)) throw new Error(`Không tìm thấy điểm neo: ${entry.title} (${entry.key})`);
    return offsets.get(entry.key);
  });
  for (let i = 0; i < toc.length; i++) {
    if (i && starts[i] <= starts[i - 1]) throw new Error(`Thứ tự mục lục không khớp nội dung: ${toc[i].title}`);
  }
  if (headings.length && (headings.length !== toc.length || headings.some((title, i) => title !== toc[i]?.title))) throw new Error('Tiêu đề trong nội dung không khớp đầy đủ với mục lục.');
  const chapters = toc.map((entry, i) => {
    let text = clean(stream.slice(starts[i], starts[i + 1] ?? stream.length));
    // Decorative chapter separators are not narrative content.
    text = text.replace(/(?:\n|^)[ \-–]*oOo[ \-–]*(?=\n|$)/g, '').trim();
    if (!compact(text).startsWith(entry.title)) throw new Error(`Nội dung không bắt đầu bằng tiêu đề: ${entry.title}`);
    const body = storyContent(stripChapterTitle(text, entry.title));
    return { ...entry, empty: !body, text: body };
  });
  return { chapters, report: { title: compact(opf('metadata').find('dc\\:title, title').first().text()), chapterCount: chapters.length, htmlFileCount: spine.length, tocCandidates: candidates.map(c => c.filter(e => chapterNumber(e.title) !== null).length), verifiedHeadingCount: headings.length, numberingMode, duplicateNumbers: [...duplicateNumbers], anomalousSourceNumbers, missingNumbers, emptyChapters: chapters.filter(c => c.empty).map(c => c.number), contentOnly: true } };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Dùng: node extract.js ["file.epub"] [--out "folder"] [--group 50]\nMặc định: INPUT_FILE trong code, xuất vào convertEPUB/output/<tên-truyện>/chapters và merge. Chỉ lấy nội dung truyện. Không ghi đè kết quả cũ.');
    return;
  }
  const input = path.resolve(args[0] && !args[0].startsWith("--") ? args.shift() : INPUT_FILE);
  let output, groupSize = 50;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--out' && args.length) output = path.resolve(args.shift());
    else if (flag === '--group' && args.length) groupSize = Number(args.shift());
    else if (flag === '--keep-credits') throw new Error('Tool chỉ xuất nội dung truyện; --keep-credits không còn được hỗ trợ.');
    else throw new Error(`Tham số không hợp lệ: ${flag}`);
  }
  if (!Number.isSafeInteger(groupSize) || groupSize < 1) throw new Error('--group phải là số nguyên dương.');
  if (path.extname(input).toLowerCase() !== '.epub') throw new Error('Đầu vào phải là file .epub.');
  const inputStat = await fs.stat(input).catch(error => {
    if (error.code === 'ENOENT') throw new Error(`Không tìm thấy EPUB: ${input}. Kiểm tra INPUT_FILE; đường dẫn Windows dùng String.raw hoặc dấu /.`);
    throw error;
  });
  if (!inputStat.isFile()) throw new Error(`Đường dẫn EPUB không phải file: ${input}`);
  const bookFolder = path.basename(input, path.extname(input)).normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  output ||= path.join(OUTPUT_DIR, bookFolder || 'epub');
  const existing = await fs.readdir(output).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  if (existing.length) throw new Error(`Thư mục kết quả đã có dữ liệu. Chọn --out khác: ${output}`);
  console.log(`Đang phân tích: ${input}`);
  const { chapters, report } = extractEpub(new AdmZip(input));
  if (report.numberingMode === 'toc-order') console.log(`Mục lục lỗi số: đánh số file theo thứ tự nội dung. Số gốc trùng: ${report.duplicateNumbers.join(', ')}; số gốc thiếu: ${report.missingNumbers.join(', ')}. Xem ánh xạ trong report.json.`);
  await fs.mkdir(path.join(output, 'chapters'), { recursive: true });
  await fs.mkdir(path.join(output, 'merge'), { recursive: true });
  const chapterFiles = [], mergedFiles = [];
  for (const chapter of chapters) {
    const file = `chuong-${chapter.number}.txt`;
    await fs.writeFile(path.join(output, 'chapters', file), chapter.text, { encoding: 'utf8', flag: 'wx' });
    chapterFiles.push({ number: chapter.number, sourceNumber: chapter.sourceNumber, title: chapter.title, file: `chapters/${file}`, source: chapter.key, characters: chapter.text.length, empty: chapter.empty });
  }
  for (let i = 0; i < chapters.length; i += groupSize) {
    const batch = chapters.slice(i, i + groupSize);
    const file = `chuong-${batch[0].number}-${batch.at(-1).number}.txt`;
    const text = batch.map(c => c.text.trimEnd()).join('\n\n') + '\n';
    await fs.writeFile(path.join(output, 'merge', file), text, { encoding: 'utf8', flag: 'wx' });
    mergedFiles.push({ file: `merge/${file}`, chapterCount: batch.length, first: batch[0].number, last: batch.at(-1).number, chapterNumbers: batch.map(c => c.number) });
  }
  // Re-read actual outputs: every merged file must equal its source chapters.
  for (const merged of mergedFiles) {
    const texts = [];
    for (const n of merged.chapterNumbers) texts.push((await fs.readFile(path.join(output, 'chapters', `chuong-${n}.txt`), 'utf8')).trimEnd());
    if (await fs.readFile(path.join(output, merged.file), 'utf8') !== texts.join('\n\n') + '\n') throw new Error(`Kiểm tra file gộp thất bại: ${merged.file}`);
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ ...report, input, includeChapterTitles: false, groupSize, mergedFileCount: mergedFiles.length, outputVerified: true, chapters: chapterFiles, merge: mergedFiles }, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  console.log(`Hoàn tất: ${chapters.length} chương, ${mergedFiles.length} file gộp.\nKết quả: ${output}\nKiểm tra mục lục, điểm neo, tiêu đề và file gộp: đạt.`);
  if (report.emptyChapters.length) console.log(`Lưu ý: chương rỗng trong nguồn EPUB: ${report.emptyChapters.join(', ')}. Đã giữ tên file và ghi vào report.json.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`Lỗi: ${error.message}`); process.exitCode = 1; });
