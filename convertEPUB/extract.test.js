import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { extractEpub, storyContent } from './extract.js';

function fixture({ broken = false, duplicate = false } = {}) {
  const zip = new AdmZip();
  const add = (name, text) => zip.addFile(name, Buffer.from(text));
  add('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>');
  add('OEBPS/book.opf', '<package><metadata><dc:title xmlns:dc="urn:dc">Thử nghiệm</dc:title></metadata><manifest><item id="a" href="a.html" media-type="application/xhtml+xml"/><item id="b" href="b%20file.html" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>');
  add('OEBPS/a.html', `<html><body><div class="chapter_link"><a href="#one">Chương 1: Một</a></div><div class="chapter_link"><a href="b%20file.html#${broken ? 'absent' : 'two'}">Chương 2: Hai</a></div><div id="one"><div class="chapter_title">Chương 1: Một</div><div class="book_credit">Nguồn: thử</div><p>Đoạn <em>tiếng Việt</em> &amp; dấu.</p><p>Đoạn thứ hai.</p></div>${duplicate ? '<a id="one"></a>' : ''}</body></html>`);
  add('OEBPS/b file.html', '<html><body><p>Phần tiếp chương một.</p><div id="two"><div class="chapter_title">Chương 2: Hai</div><p>Nội dung chương hai.<br/>Dòng kế tiếp.</p></div></body></html>');
  return zip;
}

test('Giữ đoạn, inline, Unicode và chương qua file; cắt chương chung file', () => {
  const { chapters, report } = extractEpub(fixture());
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].text, 'Đoạn tiếng Việt & dấu.\n\nĐoạn thứ hai.\n\nPhần tiếp chương một.\n');
  assert.equal(chapters[1].text, 'Nội dung chương hai.\nDòng kế tiếp.\n');
  assert.deepEqual(report.missingNumbers, []);
  assert.equal(report.verifiedHeadingCount, 2);
});
test('Không xuất âm thầm khi điểm neo bị thiếu', () => assert.throws(() => extractEpub(fixture({ broken: true })), /Không tìm thấy điểm neo/));
test('Từ chối điểm neo trùng', () => assert.throws(() => extractEpub(fixture({ duplicate: true })), /Điểm neo trùng/));
test('Chỉ lấy truyện, không giữ nguồn', () => assert.doesNotMatch(extractEpub(fixture(), { keepCredits: true }).chapters[0].text, /Nguồn: thử/));
test('Bỏ nhãn quyển và dịch giả nhưng giữ câu truyện', () => {
  const text = 'Quyển 1: Ma tính không đổi\n\nDịch: lamlamyu17\n\nPhương Nguyên bước đi.\n\nNhóm dịch: Thiên Tuyết\n\nQuyển sách nằm trên bàn.';
  assert.equal(storyContent(text), 'Phương Nguyên bước đi.\n\nQuyển sách nằm trên bàn.\n');
});
test('Bỏ quảng bá inline nhưng giữ truyện ở cả hai phía', () => {
  assert.equal(storyContent('Hắn bước đi. Truyện được copy tại Truyenyy[.]com Nàng theo sau.\n\nChương 26:: Chiến đấu!\n\nĐọc truyện với❤http://truyenyy/\n\nTên gã sai vặt vẫn ở đây.'), 'Hắn bước đi. Nàng theo sau.\n\nTên gã sai vặt vẫn ở đây.\n');
  assert.equal(storyContent('Truyện được đăng tại T r u y ệ n yy . C o m "Uống"'), '"Uống"\n');
});
test('Bỏ đoạn chú thích và tham chiếu, giữ lời truyện và số thực', () => {
  const text = '(1): Tố vấn là một chương trong Hoàng Đế Nội Kinh\n\n"Thượng cổ chi nhân" (2).\n\nDiệp Phàm khép cuốn sách.\n\n(2) Người thượng cổ sống tới trăm tuổi.\n\nHắn xem "Sưu Kỳ" (3), rồi bước đi.\n\n(3) "Sưu Kỳ": Sưu tầm truyện kỳ lạ.\n\nHắn có một trăm (100) viên đá.';
  assert.equal(storyContent(text), '"Thượng cổ chi nhân".\n\nDiệp Phàm khép cuốn sách.\n\nHắn xem "Sưu Kỳ", rồi bước đi.\n\nHắn có một trăm (100) viên đá.\n');
});
test('Bỏ chú thích có cấu trúc EPUB và noteref', () => {
  const zip = fixture();
  const file = 'OEBPS/b file.html';
  zip.updateFile(file, Buffer.from(zip.readAsText(file).replace('Nội dung chương hai.', 'Nội dung chương hai.<a epub:type="noteref" href="#note">[1]</a>').replace('</body>', '<aside epub:type="footnote" id="note">Giải thích ngoài truyện.</aside></body>')));
  const text = extractEpub(zip).chapters[1].text;
  assert.doesNotMatch(text, /Giải thích|\[1\]/);
  assert.match(text, /Nội dung chương hai/);
});
test('Số chương trùng được xuất theo thứ tự, không mất nội dung', () => {
  const zip = fixture();
  for (const name of ['OEBPS/a.html', 'OEBPS/b file.html']) zip.updateFile(name, Buffer.from(zip.readAsText(name).replaceAll('Chương 2: Hai', 'Chương 1: Hai')));
  const { chapters, report } = extractEpub(zip);
  assert.deepEqual(chapters.map(c => c.number), [1, 2]);
  assert.deepEqual(chapters.map(c => c.sourceNumber), [1, 1]);
  assert.equal(report.numberingMode, 'toc-order');
  assert.deepEqual(report.duplicateNumbers, [1]);
  assert.match(chapters[1].text, /^Nội dung chương hai/);
});
test('Số chương nhảy xa vẫn đánh số file liên tục theo thứ tự', () => {
  const zip = fixture();
  for (const name of ['OEBPS/a.html', 'OEBPS/b file.html']) zip.updateFile(name, Buffer.from(zip.readAsText(name).replaceAll('Chương 2: Hai', 'Chương 1326: Hai')));
  const result = extractEpub(zip);
  assert.equal(result.report.numberingMode, 'toc-order');
  assert.deepEqual(result.chapters.map(c => c.number), [1, 2]);
  assert.deepEqual(result.chapters.map(c => c.sourceNumber), [1, 1326]);
  assert.deepEqual(result.report.anomalousSourceNumbers, [1326]);
});
test('Tên chương không chứa số vẫn lấy đầy đủ các file chap_N theo spine', () => {
  const zip = new AdmZip();
  const add = (name, text) => zip.addFile(name, Buffer.from(text));
  add('META-INF/container.xml', '<container><rootfile full-path="book.opf"/></container>');
  add('book.opf', '<package><manifest><item id="a" href="chap_1.xhtml" media-type="application/xhtml+xml"/><item id="b" href="chap_2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>');
  add('chap_1.xhtml', '<html><body><h1>Tên chương đầu</h1><h4 class="sigil_not_in_toc"><a href="https://www.dtv-ebook.com">dtv-ebook.com</a></h4><p>Nội dung một.</p></body></html>');
  add('chap_2.xhtml', '<html><body><h1>Tên chương sau</h1><p>Nội dung hai.</p></body></html>');
  const result = extractEpub(zip);
  assert.deepEqual(result.chapters.map(c => c.number), [1, 2]);
  assert.deepEqual(result.chapters.map(c => c.text), ['Nội dung một.\n', 'Nội dung hai.\n']);
});
test('Đọc mục lục liên kết HTML không có chapter_link', () => {
  const zip = fixture();
  zip.updateFile('OEBPS/a.html', Buffer.from(zip.readAsText('OEBPS/a.html').replaceAll('class="chapter_link"', 'class="toc-entry"')));
  assert.equal(extractEpub(zip).chapters.length, 2);
});
test('Chương nguyên file có tên sách, tác giả và tiêu đề tách hai dòng', () => {
  const zip = fixture();
  zip.updateFile('OEBPS/a.html', Buffer.from('<html><body><div class="chapter_link"><a href="b%20file.html">Chương 2: Hai</a></div></body></html>'));
  zip.updateFile('OEBPS/b file.html', Buffer.from('<html><body><div class="header">Tên sách</div><div class="author">Tác giả</div><author>www.dtv-ebook.com</author><div class="chuong">Chương 2</div><h4>Hai</h4><p>Nội dung truyện.</p></body></html>'));
  const result = extractEpub(zip);
  assert.equal(result.chapters[0].text, 'Nội dung truyện.\n');
});
test('Giữ số chương rỗng trong nguồn và ghi báo cáo', () => {
  const zip = fixture();
  zip.updateFile('OEBPS/b file.html', Buffer.from('<html><body><div id="two"><div class="chapter_title">Chương 2: Hai</div></div></body></html>'));
  const result = extractEpub(zip);
  assert.equal(result.chapters[1].text, '');
  assert.deepEqual(result.report.emptyChapters, [2]);
});
