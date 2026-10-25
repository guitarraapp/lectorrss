const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

// 👇 EDITA ESTA LISTA con las fuentes que quieras
const SOURCES = [
  { url: 'https://www.xataka.com/feedburner.xml', title: 'Xataka' },
  { url: 'https://hnrss.org/frontpage', title: 'Hacker News' },
  { url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', title: 'El País' },
  { url: 'https://www.microsiervos.com/index.xml', title: 'Microsiervos' },
];

const MAX_ARTICLES_PER_SOURCE = 20;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function unescapeHtml(s) {
  return (s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseXml(xmlText, sourceUrl) {
  const items = [];
  const isAtom = xmlText.includes('<feed');
  const itemRegex = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/g : /<item[\s>][\s\S]*?<\/item>/g;
  const matches = xmlText.match(itemRegex) || [];
  for (const block of matches) {
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
      return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
    };
    const linkMatch = block.match(/<link[^>]*href="([^"]+)"/i) || block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const link = linkMatch ? (linkMatch[1] || linkMatch[0].replace(/<[^>]*>/g, '').trim()) : '';
    const dateStr = get('pubDate') || get('published') || get('updated');
    const date = dateStr ? new Date(dateStr) : new Date();
    const content = unescapeHtml(get('content:encoded') || get('content') || get('summary') || get('description'));
    items.push({
      id: link || (sourceUrl + '|' + get('title')),
      sourceUrl,
      title: stripHtml(get('title')) || '(Sin título)',
      link,
      date: isNaN(date) ? new Date().toISOString() : date.toISOString(),
      snippet: stripHtml(content).slice(0, 200),
      content,
    });
  }
  return items;
}

/* Extracción con Mozilla Readability: elimina publicidad, menús, sidebars */
async function extractWithReadability(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const html = await res.text();

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document, {
      charThreshold: 100,
      keepClasses: false,
    });
    const article = reader.parse();
    if (!article || !article.content) return null;

    // Arreglar imágenes relativas
    const base = new URL(url);
    let cleaned = article.content.replace(
      /<img([^>]*?)src="([^"]+)"/gi,
      (match, pre, src) => {
        try { return `<img${pre}src="${new URL(src, base).href}"`; }
        catch { return match; }
      }
    );

    // Eliminar píxeles de tracking y atributos peligrosos
    cleaned = cleaned
      .replace(/<img[^>]*width=["']?1["']?[^>]*>/gi, '')
      .replace(/<img[^>]*height=["']?1["']?[^>]*>/gi, '')
      .replace(/ on\w+="[^"]*"/gi, '')
      .replace(/ on\w+='[^']*'/gi, '');

    return cleaned.trim();
  } catch (e) {
    return null;
  }
}

async function main() {
  const allArticles = [];
  for (const s of SOURCES) {
    try {
      console.log(`\nDescargando feed: ${s.title}`);
      const res = await fetch(s.url, { headers: { 'User-Agent': UA } });
      if (!res.ok) { console.warn(`✗ ${s.title}: HTTP ${res.status}`); continue; }
      const xml = await res.text();
      let items = parseXml(xml, s.url);
      items.sort((a, b) => new Date(b.date) - new Date(a.date));
      items = items.slice(0, MAX_ARTICLES_PER_SOURCE);
      console.log(`  ${items.length} artículos`);

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.link) continue;
        process.stdout.write(`  [${i + 1}/${items.length}] ${it.title.slice(0, 40)}… `);
        const full = await extractWithReadability(it.link);
        if (full) { it.content = full; process.stdout.write('✓\n'); }
        else process.stdout.write('(sin extracto)\n');
      }
      allArticles.push(...items);
    } catch (e) {
      console.warn(`✗ ${s.title}: ${e.message}`);
    }
  }

  allArticles.sort((a, b) => new Date(b.date) - new Date(a.date));
  const trimmed = allArticles.slice(0, 2000);

  const out = { sources: SOURCES, articles: trimmed, updatedAt: new Date().toISOString() };
  const outPath = path.join(__dirname, '..', 'data', 'feeds.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nTotal: ${trimmed.length} artículos guardados en data/feeds.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
