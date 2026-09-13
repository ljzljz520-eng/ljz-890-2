/* ===== 管理后台逻辑 ===== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const main = $('#main');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(path, opts = {}) {
  const o = { ...opts };
  if (o.body && !(o.body instanceof FormData)) {
    o.headers = { 'Content-Type': 'application/json' };
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch('/api/admin' + path, o);
  if (r.status === 401) { location.href = '/admin/login.html'; throw new Error('未登录'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || '操作失败');
  return d;
}

let toastTimer = null;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), 2600);
}

/* 误删确认：所有删除操作统一弹确认框 */
function confirmDelete(what, extra = '') {
  return confirm(`确定删除${what}吗？${extra || '删除后将移入回收站，可在回收站恢复。'}`);
}
function confirmDanger(what) {
  return confirm(`⚠️ ${what}\n此操作不可恢复，确定继续吗？`);
}

function openModal(html) {
  $('#modal').innerHTML = html;
  $('#modal-mask').classList.add('show');
}
function closeModal() { $('#modal-mask').classList.remove('show'); }
$('#modal-mask').addEventListener('click', (e) => { if (e.target.id === 'modal-mask') closeModal(); });

/* ================= 概览 ================= */
async function renderOverview() {
  const s = await api('/overview');
  main.innerHTML = `
    <h2>概 览</h2><p class="desc">站点内容总体情况</p>
    <div class="stat-grid">
      <div class="stat-card"><b>${s.martyrs}</b><span>收录人物</span></div>
      <div class="stat-card"><b>${s.photos}</b><span>照片</span></div>
      <div class="stat-card"><b>${s.documents}</b><span>文献</span></div>
      <div class="stat-card ${s.pending ? 'warn' : ''}"><b>${s.pending}</b><span>待审核留言</span></div>
      <div class="stat-card"><b>${s.approved}</b><span>已公开留言</span></div>
      <div class="stat-card"><b>${s.recycled}</b><span>回收站</span></div>
    </div>
    <div class="card" style="margin-top:20px">
      <p class="notice" style="margin-bottom:10px">温馨提示：</p>
      <p class="tip">1. 访客提交的寄语需审核后才会在前台公开，请及时处理「留言审核」中的待办。</p>
      <p class="tip">2. 删除人物、照片、文献时会先移入「回收站」，可随时恢复；回收站中可彻底删除。</p>
      <p class="tip">3. 建议定期在「数据备份」中创建备份；系统每天首次启动也会自动备份一次。</p>
      <p class="tip">4. 页脚版权与联系方式可在「站点设置」中修改，即时生效。</p>
    </div>`;
}

/* ================= 人物管理 ================= */
async function renderMartyrs() {
  const list = await api('/martyrs');
  main.innerHTML = `
    <h2>人物管理</h2><p class="desc">维护烈士生平、纪念时间、肖像等信息</p>
    <div class="toolbar">
      <button class="btn" id="add-btn">＋ 新增人物</button>
      <span class="spacer"></span><span class="tip">共 ${list.length} 位</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>肖像</th><th>姓名</th><th>生卒</th><th>籍贯</th><th>身份</th><th>纪念时间</th><th>献花/点烛</th><th>操作</th></tr></thead>
      <tbody>${list.map((m) => `
        <tr>
          <td><img src="${esc(m.portrait || '/img/portrait-placeholder.svg')}" style="width:40px;height:52px;object-fit:cover" onerror="this.src='/img/portrait-placeholder.svg'"></td>
          <td><b>${esc(m.name)}</b></td>
          <td>${esc(m.birth_date)}<br>${esc(m.death_date)}</td>
          <td>${esc(m.birthplace)}</td>
          <td>${esc(m.title)}</td>
          <td style="max-width:180px">${esc(m.memorial_date)}</td>
          <td>🌼${m.flowers} 🕯️${m.candles}</td>
          <td style="white-space:nowrap">
            <button class="btn sm" data-edit="${m.id}">编辑</button>
            <button class="btn sm gray" data-del="${m.id}" data-name="${esc(m.name)}">删除</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="8" class="empty">暂无人物，请点击「新增人物」</td></tr>'}
      </tbody></table></div>`;

  $('#add-btn').onclick = () => martyrForm();
  $$('[data-edit]').forEach((b) => (b.onclick = () => {
    const m = list.find((x) => x.id == b.dataset.edit);
    martyrForm(m);
  }));
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirmDelete(`人物「${b.dataset.name}」`, '删除后移入回收站，其照片与文献将一并隐藏，可在回收站恢复。')) return;
    await api('/martyrs/' + b.dataset.del, { method: 'DELETE' });
    toast('已删除（移入回收站）');
    renderMartyrs(); refreshBadge();
  }));
}

function martyrForm(m) {
  const isEdit = !!m;
  m = m || {};
  openModal(`
    <h3>${isEdit ? '编辑人物' : '新增人物'}</h3>
    <div class="form-grid">
      <div><label>姓名 *</label><input id="f-name" value="${esc(m.name || '')}"></div>
      <div><label>性别</label><input id="f-gender" value="${esc(m.gender || '')}"></div>
      <div><label>出生日期</label><input id="f-birth" value="${esc(m.birth_date || '')}" placeholder="如 1920-03-15"></div>
      <div><label>牺牲日期</label><input id="f-death" value="${esc(m.death_date || '')}" placeholder="如 1948-05-12"></div>
      <div><label>籍贯</label><input id="f-birthplace" value="${esc(m.birthplace || '')}"></div>
      <div><label>身份 / 职务</label><input id="f-title" value="${esc(m.title || '')}" placeholder="如 革命烈士 · 某部排长"></div>
      <div class="full"><label>纪念时间</label><input id="f-memorial" value="${esc(m.memorial_date || '')}" placeholder="如 每年5月12日（牺牲纪念日）、9月30日（烈士纪念日）"></div>
      <div class="full"><label>肖像照片</label>
        <div style="display:flex;gap:14px;align-items:flex-start">
          <div style="flex:1">
            <input type="file" id="f-portrait-file" accept="image/*">
            <input type="hidden" id="f-portrait" value="${esc(m.portrait || '')}">
            <p class="tip">支持 JPG/PNG，不超过 5MB</p>
          </div>
          <img class="portrait-preview" id="f-portrait-preview" src="${esc(m.portrait || '/img/portrait-placeholder.svg')}" onerror="this.src='/img/portrait-placeholder.svg'">
        </div>
      </div>
      <div class="full"><label>生平简介</label><textarea id="f-biography">${esc(m.biography || '')}</textarea></div>
      <div class="full"><label>英雄事迹</label><textarea id="f-deeds">${esc(m.deeds || '')}</textarea></div>
    </div>
    <div class="form-actions">
      <button class="btn" id="save-btn">${isEdit ? '保存修改' : '确认新增'}</button>
      <button class="btn gray" id="cancel-btn">取消</button>
    </div>`);
  $('#cancel-btn').onclick = closeModal;
  $('#f-portrait-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await api('/upload', { method: 'POST', body: fd });
      $('#f-portrait').value = r.filename;
      $('#f-portrait-preview').src = r.filename;
      toast('肖像已上传');
    } catch (ex) { toast(ex.message, true); }
  };
  $('#save-btn').onclick = async () => {
    const body = {
      name: $('#f-name').value.trim(),
      gender: $('#f-gender').value.trim(),
      birth_date: $('#f-birth').value.trim(),
      death_date: $('#f-death').value.trim(),
      birthplace: $('#f-birthplace').value.trim(),
      title: $('#f-title').value.trim(),
      memorial_date: $('#f-memorial').value.trim(),
      portrait: $('#f-portrait').value,
      biography: $('#f-biography').value,
      deeds: $('#f-deeds').value,
    };
    if (!body.name) return toast('请填写姓名', true);
    try {
      if (isEdit) await api('/martyrs/' + m.id, { method: 'PUT', body });
      else await api('/martyrs', { method: 'POST', body });
      closeModal(); toast(isEdit ? '已保存' : '已新增');
      renderMartyrs();
    } catch (ex) { toast(ex.message, true); }
  };
}

/* ================= 照片管理 ================= */
async function renderPhotos() {
  const [photos, martyrs] = await Promise.all([api('/photos'), api('/martyrs')]);
  const opts = martyrs.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  main.innerHTML = `
    <h2>照片管理</h2><p class="desc">上传与维护人物历史照片</p>
    <div class="card">
      <div class="form-grid" style="grid-template-columns:1fr 1fr 1fr auto;align-items:end">
        <div><label>所属人物</label><select id="p-martyr"><option value="">请选择</option>${opts}</select></div>
        <div><label>照片说明</label><input id="p-caption" maxlength="100" placeholder="如 1947年冬 摄于家乡"></div>
        <div><label>照片文件</label><input type="file" id="p-file" accept="image/*"></div>
        <button class="btn" id="p-upload">上传照片</button>
      </div>
    </div>
    ${photos.length ? `<div class="photo-grid">${photos.map((p) => `
      <div class="photo-cell">
        <img src="${esc(p.filename)}" onerror="this.src='/img/portrait-placeholder.svg'">
        <p class="cap" title="${esc(p.caption)}">${esc(p.caption || '（无说明）')}</p>
        <p class="cap tip">${esc(p.martyr_name || '')}</p>
        <div class="ops">
          <button class="btn sm" data-edit="${p.id}" data-cap="${esc(p.caption)}" data-sort="${p.sort_order}">说明</button>
          <button class="btn sm gray" data-del="${p.id}">删除</button>
        </div>
      </div>`).join('')}</div>` : '<p class="empty">暂无照片</p>'}`;

  $('#p-upload').onclick = async () => {
    const file = $('#p-file').files[0];
    if (!$('#p-martyr').value) return toast('请选择所属人物', true);
    if (!file) return toast('请选择照片文件', true);
    const fd = new FormData();
    fd.append('martyr_id', $('#p-martyr').value);
    fd.append('caption', $('#p-caption').value.trim());
    fd.append('file', file);
    try {
      await api('/photos', { method: 'POST', body: fd });
      toast('照片已上传'); renderPhotos();
    } catch (ex) { toast(ex.message, true); }
  };
  $$('[data-edit]').forEach((b) => (b.onclick = async () => {
    const cap = prompt('照片说明：', b.dataset.cap || '');
    if (cap === null) return;
    const sort = Number(prompt('排序号（数字越小越靠前）：', b.dataset.sort || '0') || '0') || 0;
    await api('/photos/' + b.dataset.edit, { method: 'PUT', body: { caption: cap, sort_order: sort } });
    toast('已保存'); renderPhotos();
  }));
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirmDelete('该照片')) return;
    await api('/photos/' + b.dataset.del, { method: 'DELETE' });
    toast('已删除（移入回收站）'); renderPhotos(); refreshBadge();
  }));
}

/* ================= 文献管理 ================= */
async function renderDocuments() {
  const [docs, martyrs] = await Promise.all([api('/documents'), api('/martyrs')]);
  main.innerHTML = `
    <h2>文献管理</h2><p class="desc">维护家书、档案、报道等文献资料</p>
    <div class="toolbar">
      <button class="btn" id="add-btn">＋ 新增文献</button>
      <span class="spacer"></span><span class="tip">共 ${docs.length} 篇</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>标题</th><th>类型</th><th>相关人物</th><th>收录时间</th><th>操作</th></tr></thead>
      <tbody>${docs.map((d) => `
        <tr>
          <td><b>${esc(d.title)}</b></td>
          <td>${esc(d.category)}</td>
          <td>${esc(d.martyr_name || '综合资料')}</td>
          <td>${esc(d.created_at)}</td>
          <td style="white-space:nowrap">
            <button class="btn sm" data-edit="${d.id}">编辑</button>
            <button class="btn sm gray" data-del="${d.id}" data-title="${esc(d.title)}">删除</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="5" class="empty">暂无文献</td></tr>'}
      </tbody></table></div>`;

  $('#add-btn').onclick = () => docForm(null, martyrs);
  $$('[data-edit]').forEach((b) => (b.onclick = () => docForm(docs.find((x) => x.id == b.dataset.edit), martyrs)));
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirmDelete(`文献《${b.dataset.title}》`)) return;
    await api('/documents/' + b.dataset.del, { method: 'DELETE' });
    toast('已删除（移入回收站）'); renderDocuments(); refreshBadge();
  }));
}

function docForm(d, martyrs) {
  const isEdit = !!d;
  d = d || {};
  const cats = ['文献', '家书', '档案', '报道', '纪念文章'];
  openModal(`
    <h3>${isEdit ? '编辑文献' : '新增文献'}</h3>
    <div class="form-grid">
      <div><label>标题 *</label><input id="d-title" value="${esc(d.title || '')}"></div>
      <div><label>类型</label><select id="d-category">${cats.map((c) => `<option ${d.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div class="full"><label>相关人物</label><select id="d-martyr">
        <option value="">综合资料（不关联人物）</option>
        ${martyrs.map((m) => `<option value="${m.id}" ${d.martyr_id === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
      </select></div>
      <div class="full"><label>正文内容</label><textarea id="d-content" style="min-height:180px">${esc(d.content || '')}</textarea></div>
    </div>
    <div class="form-actions">
      <button class="btn" id="save-btn">${isEdit ? '保存修改' : '确认新增'}</button>
      <button class="btn gray" id="cancel-btn">取消</button>
    </div>`);
  $('#cancel-btn').onclick = closeModal;
  $('#save-btn').onclick = async () => {
    const body = {
      title: $('#d-title').value.trim(),
      category: $('#d-category').value,
      martyr_id: $('#d-martyr').value || null,
      content: $('#d-content').value,
    };
    if (!body.title) return toast('请填写标题', true);
    try {
      if (isEdit) await api('/documents/' + d.id, { method: 'PUT', body });
      else await api('/documents', { method: 'POST', body });
      closeModal(); toast(isEdit ? '已保存' : '已新增'); renderDocuments();
    } catch (ex) { toast(ex.message, true); }
  };
}

/* ================= 留言审核 ================= */
let msgStatus = 'pending';
async function renderMessages() {
  const list = await api('/messages?status=' + msgStatus);
  const tabs = [['pending', '待审核'], ['approved', '已公开'], ['rejected', '已拒绝'], ['all', '全部']];
  main.innerHTML = `
    <h2>留言审核</h2><p class="desc">访客寄语审核通过后才会在前台公开</p>
    <div class="toolbar">${tabs.map(([k, n]) => `<button class="pill ${msgStatus === k ? 'active' : ''}" data-st="${k}">${n}</button>`).join('')}</div>
    ${list.map((g) => `
      <div class="msg-card">
        <p>${esc(g.content)}</p>
        <p class="meta">
          <span>署名：${esc(g.author)}</span>
          <span>寄语对象：${esc(g.martyr_name || '全体英烈')}</span>
          <span>提交时间：${esc(g.created_at)}</span>
          <span class="tag ${g.status}">${{ pending: '待审核', approved: '已公开', rejected: '已拒绝' }[g.status]}</span>
        </p>
        <div style="display:flex;gap:8px">
          ${g.status !== 'approved' ? `<button class="btn sm" data-act="approve" data-id="${g.id}">通过并公开</button>` : ''}
          ${g.status !== 'rejected' ? `<button class="btn sm gray" data-act="reject" data-id="${g.id}">拒绝</button>` : ''}
          <button class="btn sm line" data-del="${g.id}">删除</button>
        </div>
      </div>`).join('') || '<p class="empty">暂无相关留言</p>'}`;

  $$('[data-st]').forEach((b) => (b.onclick = () => { msgStatus = b.dataset.st; renderMessages(); }));
  $$('[data-act]').forEach((b) => (b.onclick = async () => {
    await api(`/messages/${b.dataset.id}/review`, { method: 'POST', body: { action: b.dataset.act } });
    toast(b.dataset.act === 'approve' ? '已通过并公开' : '已拒绝');
    renderMessages(); refreshBadge();
  }));
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirm('确定删除该留言吗？删除后不可恢复。')) return;
    await api('/messages/' + b.dataset.del, { method: 'DELETE' });
    toast('已删除'); renderMessages(); refreshBadge();
  }));
}

/* ================= 回收站 ================= */
async function renderRecycle() {
  const r = await api('/recycle');
  const section = (title, arr, type, label) => `
    <div class="card"><h3 style="font-size:16px;letter-spacing:2px;margin-bottom:12px">${title}（${arr.length}）</h3>
    ${arr.length ? `<table><tbody>${arr.map((x) => `
      <tr><td>${label(x)}</td>
      <td style="width:170px;white-space:nowrap">
        <button class="btn sm" data-restore="${type}:${x.id}">恢 复</button>
        <button class="btn sm line" data-purge="${type}:${x.id}">彻底删除</button>
      </td></tr>`).join('')}</tbody></table>` : '<p class="empty">空</p>'}</div>`;
  main.innerHTML = `
    <h2>回收站</h2><p class="desc">误删的内容可在此恢复；彻底删除前请确认已备份</p>
    ${section('人物', r.martyrs, 'martyrs', (x) => `<b>${esc(x.name)}</b>`)}
    ${section('照片', r.photos, 'photos', (x) => `${esc(x.caption || x.filename)} <span class="tip">（${esc(x.martyr_name || '')}）</span>`)}
    ${section('文献', r.documents, 'documents', (x) => `《${esc(x.title)}》 <span class="tip">（${esc(x.martyr_name || '综合资料')}）</span>`)}`;

  $$('[data-restore]').forEach((b) => (b.onclick = async () => {
    const [type, id] = b.dataset.restore.split(':');
    await api(`/recycle/${type}/${id}/restore`, { method: 'POST' });
    toast('已恢复'); renderRecycle(); refreshBadge();
  }));
  $$('[data-purge]').forEach((b) => (b.onclick = async () => {
    const [type, id] = b.dataset.purge.split(':');
    if (!confirmDanger('彻底删除后无法恢复（建议先在「数据备份」中创建备份）。')) return;
    await api(`/recycle/${type}/${id}`, { method: 'DELETE' });
    toast('已彻底删除'); renderRecycle(); refreshBadge();
  }));
}

/* ================= 站点设置 ================= */
const SETTING_FIELDS = [
  ['site_name', '站点名称'], ['site_slogan', '站点标语'],
  ['footer_copyright', '页脚版权信息'], ['contact_phone', '联系电话'],
  ['contact_email', '联系邮箱'], ['contact_address', '联系地址'], ['icp', '备案号'],
];
async function renderSettings() {
  const s = await api('/settings');
  main.innerHTML = `
    <h2>站点设置</h2><p class="desc">页脚版权与联系方式等配置，保存后前台即时生效</p>
    <div class="card"><div class="form-grid">
      ${SETTING_FIELDS.map(([k, n]) => `
        <div class="${k.includes('copyright') || k === 'contact_address' ? 'full' : ''}">
          <label>${n}</label><input id="s-${k}" value="${esc(s[k] || '')}">
        </div>`).join('')}
    </div>
    <div class="form-actions"><button class="btn" id="save-btn">保存设置</button></div></div>`;
  $('#save-btn').onclick = async () => {
    const body = {};
    SETTING_FIELDS.forEach(([k]) => (body[k] = $('#s-' + k).value.trim()));
    await api('/settings', { method: 'PUT', body });
    toast('设置已保存');
  };
}

/* ================= 数据备份 ================= */
async function renderBackups() {
  const list = await api('/backups');
  main.innerHTML = `
    <h2>数据备份</h2><p class="desc">备份包含全部内容数据与已上传图片；恢复前系统会自动再备份一次当前数据</p>
    <div class="toolbar">
      <button class="btn" id="create-btn">＋ 立即创建备份</button>
      <label class="btn gray" style="margin:0">从备份文件恢复<input type="file" id="restore-file" accept=".json" style="display:none"></label>
      <span class="spacer"></span><span class="tip">系统每天首次启动会自动备份一次</span>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>备份名称</th><th>创建时间</th><th>内容</th><th>操作</th></tr></thead>
      <tbody>${list.map((b) => `
        <tr>
          <td>${esc(b.id)}</td>
          <td>${esc((b.created_at || '').replace('T', ' ').slice(0, 19))}</td>
          <td class="tip">人物 ${b.counts.martyrs ?? 0} · 照片 ${b.counts.photos ?? 0} · 文献 ${b.counts.documents ?? 0} · 留言 ${b.counts.messages ?? 0}</td>
          <td style="white-space:nowrap">
            <button class="btn sm" data-restore="${esc(b.id)}">恢复</button>
            <a class="btn sm gray" href="/api/admin/backups/${esc(b.id)}/download">下载</a>
            <button class="btn sm line" data-del="${esc(b.id)}">删除</button>
          </td>
        </tr>`).join('') || '<tr><td colspan="4" class="empty">暂无备份</td></tr>'}
      </tbody></table></div>`;

  $('#create-btn').onclick = async () => {
    const r = await api('/backups', { method: 'POST' });
    toast('备份已创建：' + r.id); renderBackups();
  };
  $$('[data-restore]').forEach((b) => (b.onclick = async () => {
    if (!confirm(`确定从备份「${b.dataset.restore}」恢复吗？\n当前全部内容将被覆盖（系统会先自动备份当前数据）。`)) return;
    try {
      const r = await api(`/backups/${b.dataset.restore}/restore`, { method: 'POST' });
      toast('恢复成功，当前数据已另存为 ' + r.safety);
      renderBackups(); refreshBadge();
    } catch (ex) { toast(ex.message, true); }
  }));
  $$('[data-del]').forEach((b) => (b.onclick = async () => {
    if (!confirmDanger(`确定删除备份「${b.dataset.del}」吗？`)) return;
    await api('/backups/' + b.dataset.del, { method: 'DELETE' });
    toast('备份已删除'); renderBackups();
  }));
  $('#restore-file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirmDanger('从上传的备份文件恢复将覆盖当前全部内容（系统会先自动备份当前数据）。')) { e.target.value = ''; return; }
    try {
      const data = JSON.parse(await file.text());
      const r = await api('/backups/restore-data', { method: 'POST', body: data });
      toast('恢复成功，当前数据已另存为 ' + r.safety);
      renderBackups(); refreshBadge();
    } catch (ex) { toast('恢复失败：' + ex.message, true); }
    e.target.value = '';
  };
}

/* ================= 修改密码 ================= */
function renderPassword() {
  main.innerHTML = `
    <h2>修改密码</h2><p class="desc">定期更换密码可提升后台安全性</p>
    <div class="card" style="max-width:420px">
      <div class="form-grid" style="grid-template-columns:1fr">
        <div><label>原密码</label><input type="password" id="pw-old" autocomplete="current-password"></div>
        <div><label>新密码（至少 8 位）</label><input type="password" id="pw-new" autocomplete="new-password"></div>
        <div><label>确认新密码</label><input type="password" id="pw-new2" autocomplete="new-password"></div>
      </div>
      <div class="form-actions"><button class="btn" id="save-btn">确认修改</button></div>
    </div>`;
  $('#save-btn').onclick = async () => {
    const o = $('#pw-old').value, n1 = $('#pw-new').value, n2 = $('#pw-new2').value;
    if (n1 !== n2) return toast('两次输入的新密码不一致', true);
    try {
      await api('/password', { method: 'POST', body: { old_password: o, new_password: n1 } });
      toast('密码已修改');
      renderPassword();
    } catch (ex) { toast(ex.message, true); }
  };
}

/* ================= 框架 ================= */
const TABS = {
  overview: renderOverview, martyrs: renderMartyrs, photos: renderPhotos,
  documents: renderDocuments, messages: renderMessages, recycle: renderRecycle,
  settings: renderSettings, backups: renderBackups, password: renderPassword,
};

async function refreshBadge() {
  try {
    const s = await api('/overview');
    const badge = $('#pending-badge');
    if (s.pending > 0) { badge.textContent = s.pending; badge.style.display = ''; }
    else badge.style.display = 'none';
  } catch {}
}

function switchTab(tab) {
  $$('#side button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  TABS[tab]().catch((e) => toast(e.message, true));
}

(async function init() {
  try {
    const me = await api('/me');
    $('#admin-name').textContent = '管理员：' + me.username;
  } catch { return; }
  $$('#side button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));
  $('#logout').onclick = async () => {
    await api('/logout', { method: 'POST' });
    location.href = '/admin/login.html';
  };
  switchTab('overview');
  refreshBadge();
})();
