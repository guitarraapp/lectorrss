const fs = require('fs');
const path = require('path');

// 👇 EDITA ESTA LISTA con las fuentes que quieras
const SOURCES = [
  { url: 'https://www.xataka.com/feedburner.xml', title: 'Xataka' },
  { url: 'https://hnrss.org/frontpage', title: 'Hacker News' },
  { url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', title: 'El País' },
  { url: 'https://www.microsiervos.com/index.xml', title: 'Microsiervos' },
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function stripHtml(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseXml(xmlText, sourceUrl) {
  // Parser muy básico sin dependencias externas
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
    const link = linkMatch ? (linkMatch[1] || linkMatch[0].replace(/<[^>]*>/g,'').trim()) : '';
    const dateStr = get('pubDate') || get('published') || get('updated');
    const date = dateStr ? new Date(dateStr) : new Date();
    const content = get('content:encoded') || get('content') || get('summary') || get('description');
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

async function main() {
  const allArticles = [];
  for (const s of SOURCES) {
    try {
      const res = await fetch(s.url, { headers: { 'User-Agent': UA } });
      if (!res.ok) { console.warn(`✗ ${s.title}: HTTP ${res.status}`); continue; }
      const xml = await res.text();
      const items = parseXml(xml, s.url);
      allArticles.push(...items);
      console.log(`✓ ${s.title}: ${items.length} artículos`);
    } catch (e) {
      console.warn(`✗ ${s.title}: ${e.message}`);
    }
  }

  // Ordenar por fecha y limitar
  allArticles.sort((a,b) => new Date(b.date) - new Date(a.date));
  const trimmed = allArticles.slice(0, 2000);

  const out = { sources: SOURCES, articles: trimmed, updatedAt: new Date().toISOString() };
  const outPath = path.join(__dirname, '..', 'data', 'feeds.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nTotal: ${trimmed.length} artículos guardados en data/feeds.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
