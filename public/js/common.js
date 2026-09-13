/** 公共脚本：布局渲染 + 工具函数 */
async function fetchJSON(url, opts) {
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || '请求失败');
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const STAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 1.8l3.1 6.6 7.2.9-5.3 5 1.4 7.1L12 18l-6.4 3.4 1.4-7.1-5.3-5 7.2-.9z"/></svg>';
const PLACEHOLDER_IMG = '/img/portrait-placeholder.svg';

const NAV_ITEMS = [
  { href: '/', label: '首页' },
  { href: '/martyrs.html', label: '英烈名录' },
  { href: '/documents.html', label: '文献资料' },
  { href: '/messages.html', label: '留言寄语' },
];

async function initLayout(activeHref) {
  const site = await fetchJSON('/api/site');
  if (site.site_name) document.title = document.title.replace('英烈纪念园', site.site_name);

  document.getElementById('site-header').innerHTML = `
    <div class="top-ribbon">铭记历史 · 缅怀先烈 · 珍爱和平 · 开创未来</div>
    <div class="header-main">
      <div class="emblem">${STAR_SVG}</div>
      <h1 class="site-name">${esc(site.site_name)}</h1>
      <p class="site-slogan">${esc(site.site_slogan)}</p>
    </div>
    <nav class="main-nav">
      ${NAV_ITEMS.map((n) => `<a href="${n.href}" class="${n.href === activeHref ? 'active' : ''}">${n.label}</a>`).join('')}
    </nav>`;

  document.getElementById('site-footer').innerHTML = `
    <div class="footer-inner">
      <div>
        <h4>${esc(site.site_name)}</h4>
        <p>${esc(site.site_slogan)}</p>
        <p>崇尚英雄才会产生英雄，<br>争做英雄才能英雄辈出。</p>
      </div>
      <div>
        <h4>联系方式</h4>
        <p>联系电话：${esc(site.contact_phone)}</p>
        <p>电子邮箱：${esc(site.contact_email)}</p>
        <p>联系地址：${esc(site.contact_address)}</p>
      </div>
      <div>
        <h4>网上祭奠</h4>
        <p>献一束鲜花，点一支心烛，<br>寄一份哀思，传一种精神。</p>
        <p><a href="/messages.html">→ 前往留言寄语</a></p>
      </div>
    </div>
    <div class="footer-bottom">
      <span>${esc(site.footer_copyright)}</span>
      <span>${esc(site.icp)}</span>
      <a href="/admin">管理入口</a>
    </div>`;
  return site;
}

function portraitImg(src, alt) {
  return `<img src="${esc(src || PLACEHOLDER_IMG)}" alt="${esc(alt || '烈士肖像')}" onerror="this.onerror=null;this.src='${PLACEHOLDER_IMG}'">`;
}

function fmtDate(s) {
  return String(s || '').replace(/-/g, '.');
}
