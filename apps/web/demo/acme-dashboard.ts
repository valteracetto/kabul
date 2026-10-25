/**
 * Página fictícia "Acme Dashboard" (tema escuro, 1280×800 com zoom de 1,3 para ler na aba dividida) que aparece na aba Browser da captura browser.png:
 * o desktop.capture.ts renderiza este HTML numa página à parte e manda o quadro para a aba como se viesse do
 * screencast do Chromium do workspace. Dados 100% inventados, em inglês.
 */
const POINTS = [3.1, 3.4, 3.2, 3.8, 4.1, 3.9, 4.4, 4.2, 4.8, 5.1, 4.9, 5.4, 5.2, 5.8, 6.1, 5.7, 6.0, 6.24, 5.9, 6.4, 6.7];

function chart(): string {
  const W = 620, H = 220, max = 7.5, min = 2.5;
  const x = (i: number) => 20 + (i * (W - 70)) / (POINTS.length - 1);
  const y = (v: number) => H - 24 - ((v - min) / (max - min)) * (H - 48);
  const line = POINTS.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(POINTS.length - 1).toFixed(1)},${H - 24} L${x(0).toFixed(1)},${H - 24} Z`;
  const grid = [3, 4, 5, 6, 7].map((v) => `<line x1="20" x2="${W - 44}" y1="${y(v)}" y2="${y(v)}" stroke="#262b3a"/><text x="${W - 36}" y="${y(v) + 4}" fill="#6b7280" font-size="11">$${v}k</text>`).join("");
  const hi = 17, hx = x(hi), hy = y(POINTS[hi]);
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7c83ff" stop-opacity=".35"/><stop offset="1" stop-color="#7c83ff" stop-opacity="0"/></linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#g)"/>
    <path d="${line}" fill="none" stroke="#8b91ff" stroke-width="2.5" stroke-linejoin="round"/>
    <line x1="${hx}" x2="${hx}" y1="20" y2="${H - 24}" stroke="#8b91ff" stroke-dasharray="3 4" stroke-opacity=".6"/>
    <circle cx="${hx}" cy="${hy}" r="5.5" fill="#0f1220" stroke="#a5a9ff" stroke-width="2.5"/>
    <g transform="translate(${hx - 64},${hy - 62})"><rect width="128" height="44" rx="8" fill="#1c2033" stroke="#353b55"/>
      <text x="12" y="18" fill="#9ca3af" font-size="11">Oct 21</text><text x="12" y="35" fill="#f3f4f6" font-size="14" font-weight="600">$6,240</text></g>
    ${["Oct 1", "Oct 6", "Oct 11", "Oct 16", "Oct 21"].map((d, i) => `<text x="${x(i * 5) - 14}" y="${H - 4}" fill="#6b7280" font-size="11">${d}</text>`).join("")}
  </svg>`;
}

const card = (label: string, value: string, delta: string, up: boolean) =>
  `<div class="card"><div class="lbl">${label}</div><div class="val">${value}</div><div class="delta ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${delta} <span>vs last week</span></div></div>`;

const ORDERS: [string, string, string, string][] = [
  ["#10482", "Northwind Studio", "$1,240.00", "Paid"],
  ["#10481", "Bluebird Labs", "$389.50", "Paid"],
  ["#10480", "Pinecone Supply", "$2,015.00", "Pending"],
  ["#10479", "Harbor & Finch", "$742.25", "Paid"],
];

const PRODUCTS: [string, string, number, string][] = [
  ["Trail Runner 3", "Footwear", 412, "$41,200"],
  ["Canvas Daypack", "Bags", 286, "$17,160"],
  ["Merino Crew Socks", "Apparel", 905, "$13,575"],
  ["Insulated Bottle", "Gear", 344, "$10,320"],
];

export function acmeDashboardHtml(): string {
  return `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}html{zoom:1.3}body{margin:0;width:985px;height:885px;overflow:hidden;background:#0b0e17;color:#e5e7eb;font:14px -apple-system,BlinkMacSystemFont,"Inter","Helvetica Neue",sans-serif}
  header{height:56px;display:flex;align-items:center;gap:24px;padding:0 28px;border-bottom:1px solid #1f2433;background:#0f1220}
  .logo{display:flex;align-items:center;gap:10px;font-weight:700;font-size:16px;color:#f9fafb}
  .logo i{width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#7c83ff,#c084fc);display:inline-block}
  nav{display:flex;gap:22px;color:#9ca3af}nav b{color:#f3f4f6;font-weight:500}
  .grow{flex:1}.search{width:170px;height:34px;border-radius:8px;background:#161a28;border:1px solid #232838;color:#6b7280;display:flex;align-items:center;padding:0 12px;font-size:13px}
  .toggle{width:34px;height:34px;border-radius:8px;background:#1c2033;border:1px solid #353b55;display:grid;place-items:center;outline:2px solid #7c83ff;outline-offset:2px}
  .avatar{width:32px;height:32px;border-radius:50%;background:#f59e0b;color:#111;display:grid;place-items:center;font-weight:700;font-size:13px}
  main{padding:20px 28px}h1{margin:0 0 4px;font-size:24px;color:#f9fafb}.sub{color:#9ca3af;margin-bottom:22px}
  .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:14px}
  .card{background:#121624;border:1px solid #1f2433;border-radius:12px;padding:16px 18px}.lbl{color:#9ca3af;font-size:13px}
  .val{font-size:26px;font-weight:650;margin:6px 0;color:#f9fafb}.delta{font-size:12px}.delta span{color:#6b7280}.up{color:#34d399}.down{color:#f87171}
  .row{display:grid;grid-template-columns:1fr 300px;gap:16px}svg{width:100%;height:auto;display:block}.panel{background:#121624;border:1px solid #1f2433;border-radius:12px;padding:16px 18px}
  .ph{display:flex;align-items:center;margin-bottom:8px}.ph b{font-size:15px;color:#f3f4f6}.pill{margin-left:auto;font-size:12px;color:#9ca3af;background:#1a1f2f;border-radius:999px;padding:4px 10px}
  table{width:100%;border-collapse:collapse;font-size:13px}td{padding:9px 0;border-top:1px solid #1f2433}td:last-child{text-align:right}
  .st{font-size:11px;border-radius:999px;padding:3px 8px}.paid{background:#0f2e24;color:#34d399}.pending{background:#33270d;color:#fbbf24}
  .dim{color:#9ca3af}.wide{margin-top:14px}.prod td{width:25%}.prod td:last-child{text-align:right}
  .bar{display:inline-block;height:6px;border-radius:3px;background:#7c83ff;opacity:.7;margin-left:10px;vertical-align:middle}
</style></head><body>
<header><span class="logo"><i></i>Acme</span><nav><b>Dashboard</b><span>Orders</span><span>Customers</span><span>Reports</span></nav><span class="grow"></span>
  <span class="search">Search…  ⌘K</span>
  <span class="toggle" aria-label="Theme toggle"><svg width="16" height="16" viewBox="0 0 24 24" fill="#c7cbff"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg></span>
  <span class="avatar">SR</span></header>
<main><h1>Dashboard</h1><div class="sub">Last 21 days · all stores</div>
  <div class="cards">${card("Revenue", "$98,420", "8.2%", true)}${card("Orders", "1,284", "4.1%", true)}${card("Conversion", "3.6%", "0.3 pt", true)}${card("Refunds", "$1,920", "1.2%", false)}</div>
  <div class="row"><div class="panel"><div class="ph"><b>Revenue</b><span class="pill">Daily · USD</span></div>${chart()}</div>
  <div class="panel"><div class="ph"><b>Recent orders</b><span class="pill">Today</span></div><table>
    ${ORDERS.map(([id, who, amt, st]) => `<tr><td><div>${who}</div><div class="dim">${id}</div></td><td>${amt}<br><span class="st ${st.toLowerCase()}">${st}</span></td></tr>`).join("")}
  </table></div></div>
  <div class="panel wide"><div class="ph"><b>Top products</b><span class="pill">Last 21 days</span></div><table class="prod">
    <tr class="dim"><td>Product</td><td>Category</td><td>Units</td><td>Revenue</td></tr>
    ${PRODUCTS.map(([n, c, u, r]) => `<tr><td>${n}</td><td class="dim">${c}</td><td>${u}<span class="bar" style="width:${Math.round(u / 9)}px"></span></td><td>${r}</td></tr>`).join("")}
  </table></div>
</main></body></html>`;
}
