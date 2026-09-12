const sb = getSupabaseClient();

const loginView = document.getElementById('login-view');
const appView = document.getElementById('app-view');
const notAdminView = document.getElementById('not-admin-view');
const loginMsg = document.getElementById('login-msg');

let isSignupMode = false;

document.getElementById('toggle-signup').addEventListener('click', () => {
  isSignupMode = !isSignupMode;
  document.getElementById('btn-signin').textContent = isSignupMode ? 'ثبت‌نام' : 'ورود';
  document.getElementById('toggle-signup').textContent = isSignupMode
    ? 'حساب دارید؟ وارد شوید'
    : 'حساب ندارید؟ ثبت‌نام کنید';
  loginMsg.textContent = '';
});

document.getElementById('btn-signin').addEventListener('click', async () => {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) {
    loginMsg.textContent = 'ایمیل و رمز عبور را وارد کنید.';
    loginMsg.className = 'msg error';
    return;
  }
  loginMsg.textContent = 'در حال بررسی...';
  loginMsg.className = 'msg';

  const { error } = isSignupMode
    ? await sb.auth.signUp({ email, password })
    : await sb.auth.signInWithPassword({ email, password });

  if (error) {
    loginMsg.textContent = error.message;
    loginMsg.className = 'msg error';
    return;
  }

  if (isSignupMode) {
    loginMsg.textContent =
      'حساب ساخته شد. اگر تأیید ایمیل فعال است، ایمیل خود را چک کنید، سپس وارد شوید.';
    loginMsg.className = 'msg ok';
    return;
  }

  await checkAdminAndRender();
});

async function signOut() {
  await sb.auth.signOut();
  location.reload();
}
document.getElementById('btn-signout').addEventListener('click', signOut);
document.getElementById('btn-signout-2').addEventListener('click', signOut);

async function checkAdminAndRender() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    loginView.style.display = 'block';
    appView.style.display = 'none';
    notAdminView.style.display = 'none';
    return;
  }

  const { data: profile, error } = await sb
    .from('profiles')
    .select('is_admin')
    .eq('id', session.user.id)
    .single();

  if (error || !profile || !profile.is_admin) {
    loginView.style.display = 'none';
    appView.style.display = 'none';
    notAdminView.style.display = 'block';
    return;
  }

  loginView.style.display = 'none';
  notAdminView.style.display = 'none';
  appView.style.display = 'block';
  loadProducts();
}

/* ---- Tabs ------------------------------------------------------------- */

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'orders') loadOrders();
  });
});

/* ---- Products ----------------------------------------------------------
   Each row has a quick-edit strip (price / provisional / in stock — the
   things you change often) plus a "ویرایش کامل" toggle that reveals every
   other field (subcategory, style, material, height, description, colors,
   size variants). Colors are a plain comma-separated list. Variants are a
   small repeatable height+price list, stored as the same [{height,price}]
   shape the storefront's size picker already reads. */

const COLLECTION_LABEL = { lamps: 'آباژور', shades: 'شید', candles: 'شمع', decor: 'اکسسوری منزل' };
const STYLE_OPTIONS = ['', 'رومیزی', 'کنار سالنی'];

let PRODUCTS_CACHE = [];

async function loadProducts() {
  const tbody = document.getElementById('products-tbody');
  tbody.innerHTML = '<tr><td colspan="7">در حال بارگذاری...</td></tr>';

  const { data, error } = await sb
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:#b3432f">خطا: ${escapeHtml(error.message)}</td></tr>`;
    return;
  }

  PRODUCTS_CACHE = data || [];

  if (!PRODUCTS_CACHE.length) {
    tbody.innerHTML = '<tr><td colspan="7">هنوز محصولی ثبت نشده.</td></tr>';
    return;
  }

  tbody.innerHTML = PRODUCTS_CACHE.map(rowHtml).join('');

  PRODUCTS_CACHE.forEach((p) => {
    document.getElementById(`save-${p.id}`).addEventListener('click', () => saveProduct(p.id));
    document.getElementById(`del-${p.id}`).addEventListener('click', () => deleteProduct(p.id, p.name_fa));
    document.getElementById(`toggle-${p.id}`).addEventListener('click', () => toggleEdit(p.id));
  });
}

function rowHtml(p) {
  return `
    <tr data-id="${p.id}">
      <td>
        <div style="font-weight:600">${escapeHtml(p.name_fa)}</div>
        <div style="color:#8a7d6e; font-size:12px">${escapeHtml(p.slug)}</div>
        <button class="link-btn" id="toggle-${p.id}" style="padding:2px 0">ویرایش کامل ▾</button>
      </td>
      <td>${COLLECTION_LABEL[p.collection] || escapeHtml(p.collection)}</td>
      <td><input type="number" id="price-${p.id}" value="${p.price}" style="width:110px"></td>
      <td class="checkbox-cell"><input type="checkbox" id="prov-${p.id}" ${p.price_provisional ? 'checked' : ''}></td>
      <td class="checkbox-cell"><input type="checkbox" id="stock-${p.id}" ${p.in_stock ? 'checked' : ''}></td>
      <td class="narrow"><button class="btn ghost" id="save-${p.id}" style="padding:6px 12px">ذخیره</button></td>
      <td class="narrow"><button class="btn danger" id="del-${p.id}" style="padding:6px 12px">حذف</button></td>
    </tr>
    <tr id="edit-wrap-${p.id}" style="display:none">
      <td colspan="7" style="padding:0; border:0">
        <div id="edit-panel-${p.id}"></div>
      </td>
    </tr>`;
}

function editPanelHtml(p) {
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const colors = Array.isArray(p.colors) ? p.colors.join('، ') : '';
  return `
    <tr class="edit-row" id="edit-row-${p.id}">
      <td colspan="7">
        <div class="edit-grid">
          <div>
            <label>زیردسته (جنس بدنه)</label>
            <input id="f-subcategory-${p.id}" value="${escapeAttr(p.subcategory || '')}">
          </div>
          <div>
            <label>محل قرارگیری</label>
            <select id="f-style-${p.id}">
              ${STYLE_OPTIONS.map(
                (s) => `<option value="${escapeAttr(s)}" ${p.style === s ? 'selected' : ''}>${s || '—'}</option>`
              ).join('')}
            </select>
          </div>
          <div>
            <label>جنس</label>
            <input id="f-material-${p.id}" value="${escapeAttr(p.material || '')}">
          </div>
          <div>
            <label>ارتفاع پایه (سانتی‌متر)</label>
            <input id="f-height-${p.id}" type="number" value="${p.height_cm ?? ''}">
          </div>
          <div>
            <label>رنگ‌ها (با ویرگول فارسی یا انگلیسی جدا کنید)</label>
            <input id="f-colors-${p.id}" value="${escapeAttr(colors)}" placeholder="مثلاً: یاسی، سبز، آبی">
          </div>
          <div></div>
        </div>
        <div class="edit-grid wide" style="margin-top:10px">
          <div>
            <label>توضیحات</label>
            <input id="f-desc-${p.id}" value="${escapeAttr(p.description || '')}">
          </div>
        </div>
        <div style="margin-top:14px">
          <label>اندازه‌ها و قیمت هر اندازه (در صورت وجود چند سایز)</label>
          <div id="variants-list-${p.id}">
            ${variants.map((v, i) => variantRowHtml(p.id, i, v.height, v.price)).join('')}
          </div>
          <button class="link-btn" id="add-variant-${p.id}">+ افزودن اندازه</button>
        </div>
        <div style="margin-top:16px">
          <button class="btn" id="save-full-${p.id}">ذخیره همه</button>
          <span id="save-full-msg-${p.id}" class="msg" style="display:inline-block"></span>
        </div>
      </td>
    </tr>`;
}

function variantRowHtml(pid, i, height, price) {
  return `
    <div class="variant-row" data-idx="${i}">
      <input type="number" placeholder="ارتفاع (سانتی‌متر)" class="v-height" value="${height ?? ''}">
      <input type="number" placeholder="قیمت (تومان)" class="v-price" value="${price ?? ''}">
      <button class="btn ghost remove-variant" type="button">حذف</button>
    </div>`;
}

function toggleEdit(id) {
  const wrap = document.getElementById(`edit-wrap-${id}`);
  const btn = document.getElementById(`toggle-${id}`);
  const isOpen = wrap.style.display !== 'none';
  if (isOpen) {
    wrap.style.display = 'none';
    btn.textContent = 'ویرایش کامل ▾';
    return;
  }
  const p = PRODUCTS_CACHE.find((x) => x.id === id);
  const panel = document.getElementById(`edit-panel-${id}`);
  panel.innerHTML = `<table style="width:100%"><tbody>${editPanelHtml(p)}</tbody></table>`;
  wrap.style.display = 'table-row';
  btn.textContent = 'بستن ویرایش ▴';

  document.getElementById(`add-variant-${id}`).addEventListener('click', () => {
    const list = document.getElementById(`variants-list-${id}`);
    const idx = list.children.length;
    list.insertAdjacentHTML('beforeend', variantRowHtml(id, idx, '', ''));
    wireVariantRemove(list);
  });
  wireVariantRemove(document.getElementById(`variants-list-${id}`));

  document.getElementById(`save-full-${id}`).addEventListener('click', () => saveProductFull(id));
}

function wireVariantRemove(list) {
  list.querySelectorAll('.remove-variant').forEach((btn) => {
    btn.onclick = () => btn.closest('.variant-row').remove();
  });
}

async function saveProduct(id) {
  const price = Number(document.getElementById(`price-${id}`).value) || 0;
  const price_provisional = document.getElementById(`prov-${id}`).checked;
  const in_stock = document.getElementById(`stock-${id}`).checked;

  const { error } = await sb
    .from('products')
    .update({ price, price_provisional, in_stock, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    alert('خطا در ذخیره: ' + error.message);
  } else {
    loadProducts();
  }
}

async function saveProductFull(id) {
  const msg = document.getElementById(`save-full-msg-${id}`);
  msg.textContent = 'در حال ذخیره...';
  msg.className = 'msg';

  const subcategory = document.getElementById(`f-subcategory-${id}`).value.trim() || null;
  const style = document.getElementById(`f-style-${id}`).value || null;
  const material = document.getElementById(`f-material-${id}`).value.trim() || null;
  const heightVal = document.getElementById(`f-height-${id}`).value;
  const height_cm = heightVal ? Number(heightVal) : null;
  const description = document.getElementById(`f-desc-${id}`).value.trim() || null;

  const colorsRaw = document.getElementById(`f-colors-${id}`).value.trim();
  const colors = colorsRaw
    ? colorsRaw.split(/[,،]/).map((s) => s.trim()).filter(Boolean)
    : [];

  const variantRows = document.querySelectorAll(`#variants-list-${id} .variant-row`);
  const variants = [];
  for (const row of variantRows) {
    const h = row.querySelector('.v-height').value;
    const pr = row.querySelector('.v-price').value;
    if (h === '' || pr === '') continue;
    variants.push({ height: Number(h), price: Number(pr) });
  }

  const { error } = await sb
    .from('products')
    .update({
      subcategory,
      style,
      material,
      height_cm,
      description,
      colors,
      variants,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) {
    msg.textContent = 'خطا: ' + error.message;
    msg.className = 'msg error';
    return;
  }

  // Update the local cache in place rather than reloading the whole table —
  // reloading would collapse this panel immediately, hiding the very
  // confirmation message we're about to show.
  const cached = PRODUCTS_CACHE.find((x) => x.id === id);
  if (cached) Object.assign(cached, { subcategory, style, material, height_cm, description, colors, variants });

  msg.textContent = 'ذخیره شد.';
  msg.className = 'msg ok';
}

async function deleteProduct(id, name) {
  if (!confirm(`حذف «${name}»؟ این عمل قابل بازگشت نیست.`)) return;
  const { error } = await sb.from('products').delete().eq('id', id);
  if (error) {
    alert('خطا در حذف: ' + error.message);
    return;
  }
  loadProducts();
}

document.getElementById('btn-add').addEventListener('click', async () => {
  const addMsg = document.getElementById('add-msg');
  const payload = {
    slug: document.getElementById('new-slug').value.trim(),
    name_fa: document.getElementById('new-name-fa').value.trim(),
    name_en: document.getElementById('new-name-en').value.trim() || null,
    collection: document.getElementById('new-collection').value,
    subcategory: document.getElementById('new-subcategory').value.trim() || null,
    style: document.getElementById('new-style').value || null,
    material: document.getElementById('new-material').value.trim() || null,
    height_cm: document.getElementById('new-height').value ? Number(document.getElementById('new-height').value) : null,
    price: Number(document.getElementById('new-price').value) || 0,
    photo_url: document.getElementById('new-photo').value.trim() || null,
    description: document.getElementById('new-desc').value.trim() || null,
  };

  if (!payload.slug || !payload.name_fa) {
    addMsg.textContent = 'Slug و نام فارسی الزامی است.';
    addMsg.className = 'msg error';
    return;
  }

  const { error } = await sb.from('products').insert(payload);
  if (error) {
    addMsg.textContent = 'خطا: ' + error.message;
    addMsg.className = 'msg error';
    return;
  }

  addMsg.textContent = 'محصول اضافه شد.';
  addMsg.className = 'msg ok';
  [
    'new-slug', 'new-name-fa', 'new-name-en', 'new-subcategory', 'new-material',
    'new-height', 'new-price', 'new-photo', 'new-desc',
  ].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('new-style').value = '';
  loadProducts();
});

/* ---- Orders -------------------------------------------------------------
   Read-only list plus a status dropdown per order (pending/paid/shipped/
   cancelled). Order creation itself only ever happens through the real
   checkout flow (/api/orders) — this tab is for tracking, not creating. */

const STATUS_LABEL = {
  pending: 'در انتظار',
  paid: 'پرداخت‌شده',
  preparing: 'در حال آماده‌سازی',
  shipped: 'ارسال‌شده',
  delivered: 'تحویل‌شده',
  cancelled: 'لغوشده',
};

async function loadOrders() {
  const list = document.getElementById('orders-list');
  list.innerHTML = 'در حال بارگذاری...';

  const { data: orders, error } = await sb
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    list.innerHTML = `<p style="color:#b3432f">خطا: ${escapeHtml(error.message)}</p>`;
    return;
  }

  if (!orders.length) {
    list.innerHTML = '<p>هنوز سفارشی ثبت نشده.</p>';
    return;
  }

  const orderIds = orders.map((o) => o.id);
  const { data: items } = await sb
    .from('order_items')
    .select('*')
    .in('order_id', orderIds);

  const itemsByOrder = {};
  (items || []).forEach((it) => {
    (itemsByOrder[it.order_id] = itemsByOrder[it.order_id] || []).push(it);
  });

  list.innerHTML = orders.map((o) => orderCardHtml(o, itemsByOrder[o.id] || [])).join('');

  orders.forEach((o) => {
    const sel = document.getElementById(`order-status-${o.id}`);
    if (sel) sel.addEventListener('change', () => updateOrderStatus(o.id, sel.value));
  });

  loadOrdersSummary();
}

/* ---- Sales summary --------------------------------------------------------
   The order list above is capped at 100 for display, so it must NOT be the
   source for these numbers — a "total revenue" that silently only covered
   the most recent 100 orders would be actively misleading. This fetches its
   own uncapped(-ish) set instead. 1000 orders is generous headroom for this
   shop's current volume; revisit if that ever actually gets hit. */
async function loadOrdersSummary() {
  const el = document.getElementById('orders-summary');
  if (!el) return;

  const { data: allOrders, error: ordersErr } = await sb
    .from('orders')
    .select('total, status')
    .limit(1000);

  if (ordersErr || !allOrders) {
    el.innerHTML = '<p style="color:var(--danger)">خطا در محاسبه‌ی آمار فروش.</p>';
    return;
  }

  const counted = allOrders.filter((o) => o.status !== 'cancelled');
  const revenue = counted.reduce((sum, o) => sum + (o.total || 0), 0);
  const count = counted.length;
  const avg = count ? revenue / count : 0;

  // Best-sellers by quantity, excluding cancelled orders — same exclusion
  // as revenue/count above, for consistency. order_items has no status of
  // its own, so this joins against orders.status directly (via the
  // order_items -> orders foreign key) rather than filtering by an .in()
  // list of order ids, which would mean sending up to 1000 ids in the
  // query string. Not bounded by the 1000-order cap either way.
  const { data: allItems } = await sb
    .from('order_items')
    .select('name_fa, qty, orders!inner(status)')
    .neq('orders.status', 'cancelled')
    .limit(5000);

  const qtyByName = {};
  (allItems || []).forEach((it) => {
    qtyByName[it.name_fa] = (qtyByName[it.name_fa] || 0) + (it.qty || 0);
  });
  const topProducts = Object.entries(qtyByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  el.innerHTML = `
    <div class="stat-row">
      <div class="stat-box">
        <div class="stat-label">درآمد کل</div>
        <div class="stat-value">${money(revenue)}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">تعداد سفارش</div>
        <div class="stat-value">${count.toLocaleString('fa-IR')}</div>
      </div>
      <div class="stat-box">
        <div class="stat-label">میانگین ارزش سفارش</div>
        <div class="stat-value">${count ? money(avg) : '—'}</div>
      </div>
      <div class="stat-box stat-box-wide">
        <div class="stat-label">پرفروش‌ترین محصولات</div>
        ${
          topProducts.length
            ? `<ol class="top-products">${topProducts
                .map(
                  ([name, qty], i) =>
                    `<li><span>${i + 1}. ${escapeHtml(name)}</span><span>${qty.toLocaleString('fa-IR')} عدد</span></li>`
                )
                .join('')}</ol>`
            : '<div class="stat-value">—</div>'
        }
      </div>
    </div>`;
}

function orderCardHtml(o, items) {
  const statusClass = 'status-' + (o.status || 'pending');
  const date = o.created_at ? new Date(o.created_at).toLocaleString('fa-IR') : '';
  return `
    <div class="order-card">
      <div class="order-head">
        <div>
          <b>${escapeHtml(o.code)}</b>
          <span class="status-pill ${statusClass}">${STATUS_LABEL[o.status] || o.status}</span>
          <div style="color:#8a7d6e; font-size:12.5px; margin-top:4px">${escapeHtml(date)}</div>
        </div>
        <div style="text-align:left">
          <div>${escapeHtml(o.customer_name || '')} — <span class="ltr" style="direction:ltr;unicode-bidi:embed">${escapeHtml(o.phone || '')}</span></div>
          <div style="color:#8a7d6e; font-size:12.5px">${escapeHtml(o.city || '')}${o.address ? '، ' + escapeHtml(o.address) : ''}</div>
        </div>
      </div>
      <div class="order-items">
        ${items
          .map(
            (it) =>
              `<div class="order-item-row"><span>${escapeHtml(it.name_fa)} × ${it.qty}</span><span>${money(it.unit_price * it.qty)}</span></div>`
          )
          .join('')}
        <div class="order-item-row" style="font-weight:700; margin-top:6px; padding-top:6px; border-top:1px solid var(--divider)">
          <span>جمع کل</span><span>${money(o.total)}</span>
        </div>
        ${o.note ? `<div style="margin-top:8px; color:#6b5f52">یادداشت: ${escapeHtml(o.note)}</div>` : ''}
      </div>
      <div style="margin-top:12px">
        <label style="display:inline;margin-inline-end:8px">وضعیت:</label>
        <select id="order-status-${o.id}" style="width:auto; display:inline-block">
          ${Object.keys(STATUS_LABEL)
            .map((k) => `<option value="${k}" ${o.status === k ? 'selected' : ''}>${STATUS_LABEL[k]}</option>`)
            .join('')}
        </select>
      </div>
    </div>`;
}

async function updateOrderStatus(id, status) {
  const { error } = await sb.from('orders').update({ status }).eq('id', id);
  if (error) {
    alert('خطا در تغییر وضعیت: ' + error.message);
    loadOrders();
    return;
  }
  // Status feeds directly into the revenue/count exclusion above, so a
  // change here (into or out of 'cancelled') must refresh the summary too.
  loadOrdersSummary();
}

function money(n) {
  return new Intl.NumberFormat('fa-IR').format(Math.round(n || 0)) + ' تومان';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// Boot
checkAdminAndRender();
