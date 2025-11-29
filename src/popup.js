document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const registryEl = document.getElementById('registry');
  const pkgEl = document.getElementById('pkg');
  const searchBtn = document.getElementById('search');
  const backBtn = document.getElementById('back');
  const output = document.getElementById('output');
  const status = document.getElementById('status');
  const showGraphBtn = document.getElementById('show-graph');
  const graphArea = document.getElementById('graph-area');
  const graphSvg = document.getElementById('graph');
  const closeGraphBtn = document.getElementById('close-graph');
  const clearCacheBtn = document.getElementById('clear-cache');

  const progressArea = document.getElementById('progress-area');
  const progressText = document.getElementById('progress-text');
  const progressBar = document.getElementById('progress-bar');
  const progressRemaining = document.getElementById('progress-remaining');
  const cancelDownloadBtn = document.getElementById('cancel-download');

  // State
  const STORAGE_KEY = 'npm_cache_v1';
  let runtimeCache = {};
  let historyStack = [];
  let isCancelling = false;
  let isDownloadingRecursive = false;

  // storage helpers
  const storageGet = (k) => new Promise(res => chrome.storage.local.get(k, obj => res(obj[k])));
  const storageSet = (k, v) => new Promise(res => chrome.storage.local.set({ [k]: v }, res));
  const storageRemove = (k) => new Promise(res => chrome.storage.local.remove(k, res));

  // init
  (async function init() {
    try {
      const saved = await storageGet(STORAGE_KEY);
      if (saved && typeof saved === 'object') runtimeCache = saved;
    } catch (e) {
      console.warn('load cache err', e);
    }
    setStatus('Ready');
  })();

  // utils
  function setStatus(txt, isError = false) {
    status.textContent = txt || '';
    status.style.color = isError ? '#b91c1c' : '';
  }

  function makeKey(reg, name) { return `${reg}::${name}`; }
  function makeUrl(reg, name) { return `${reg.replace(/\/$/,'')}/${encodeURIComponent(name)}/latest`; }

  async function fetchPackage(reg, name) {
    const key = makeKey(reg, name);
    if (runtimeCache[key]) return runtimeCache[key];

    setStatus(`Fetching ${name}...`);
    const url = makeUrl(reg, name);
    let res;
    try { res = await fetch(url); } catch (e) { throw new Error(`Network error: ${e.message}`); }
    const text = await res.text();
    if (!res.ok) {
      try {
        const j = JSON.parse(text);
        throw new Error(j.error || `${res.status} ${res.statusText}`);
      } catch (_) { throw new Error(`HTTP ${res.status}: ${text}`); }
    }
    let json;
    try { json = JSON.parse(text); } catch (e) { throw new Error('Invalid JSON from registry'); }
    if (json && json.error) throw new Error(json.error);
    runtimeCache[key] = json;
    storageSet(STORAGE_KEY, runtimeCache).catch(()=>{});
    return json;
  }

  function downloadTarball(data, name) {
    const tar = data?.dist?.tarball;
    if (!tar) { setStatus(`Tarball not found for ${name}`, true); return; }
    try {
      chrome.downloads.download({ url: tar, filename: `${name}.tgz` });
      setStatus(`Queued download: ${name}`);
    } catch (e) {
      console.warn(e);
      setStatus('Download error', true);
    }
  }

  // safe helpers to build elements
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.textContent = v;
      else node.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach(ch => {
      if (ch == null) return;
      if (typeof ch === 'string') node.appendChild(document.createTextNode(ch));
      else node.appendChild(ch);
    });
    return node;
  }

  function clearElement(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // Error panel (safe)
  function showErrorPanel(message) {
    clearElement(output);
    const box = el('div', { class: 'error-panel' });
    box.textContent = message ?? 'Error';
    output.appendChild(box);
  }

  // Render package UI (no innerHTML)
  async function renderPackageView(reg, name, pushHistory = true) {
    try {
      const data = await fetchPackage(reg, name);

      if (pushHistory && output._current) {
        historyStack.push(output._current);
        if (historyStack.length > 0) backBtn.style.display = 'inline-block';
      }

      output._current = { reg, name, data };

      clearElement(output);

      // pack container
      const pack = el('div', { class: 'pack-info' });

      // header with download button
      const header = el('div', { class: 'pack-header' });
      const titleWrap = el('div', {}, [
        el('strong', { text: name }),
        el('div', { class: 'meta', text: `version: ${data.version ?? '—'}` })
      ]);
      const downloadWrap = el('div');
      const downloadBtn = el('button', { id: 'btn-download', text: 'Download package' });
      downloadWrap.appendChild(downloadBtn);
      header.appendChild(titleWrap);
      header.appendChild(downloadWrap);
      pack.appendChild(header);

      // description
      if (data.description) {
        pack.appendChild(el('div', { class: 'meta', text: data.description }));
      }

      // dependencies header
      const deps = data.dependencies || {};
      const depCount = Object.keys(deps).length;
      const depsHeader = el('div', { class: 'deps-header' });
      depsHeader.appendChild(el('div', {}, [el('strong', { text: `Dependencies (${depCount})` })]));
      const selectAllLabel = el('label');
      const selectAllCheckbox = el('input', { id: 'select-all', type: 'checkbox' });
      selectAllCheckbox.checked = true;
      selectAllLabel.appendChild(selectAllCheckbox);
      selectAllLabel.appendChild(document.createTextNode(' Select all'));
      depsHeader.appendChild(selectAllLabel);
      pack.appendChild(depsHeader);

      // deps list
      const depsList = el('div', { class: 'deps-list', id: 'deps-list' });
      if (depCount === 0) {
        depsList.appendChild(el('div', { style: 'padding:6px;color:#6b7280', text: 'No dependencies' }));
      } else {
        for (const [d, v] of Object.entries(deps)) {
          const depRow = el('div', { class: 'dependency' });
          depRow.dataset.name = d;
          depRow.dataset.ver = v;

          const cb = el('input', { class: 'checkbox', type: 'checkbox', value: d });
          cb.checked = true;

          const toggle = el('span', { class: 'toggle', text: '+' });
          toggle.title = 'expand';

          const nameEl = el('span', { class: 'dep-name', text: d });
          nameEl.style.fontWeight = '600';
          nameEl.style.cursor = 'pointer';
          nameEl.style.marginLeft = '6px';

          const verEl = el('span', { class: 'meta', text: v });
          verEl.style.marginLeft = '8px';

          const childContainer = el('div', { class: 'child' });
          childContainer.style.display = 'none';
          childContainer.style.paddingLeft = '22px';
          childContainer.style.marginTop = '6px';

          depRow.appendChild(cb);
          depRow.appendChild(toggle);
          depRow.appendChild(nameEl);
          depRow.appendChild(verEl);
          depRow.appendChild(childContainer);

          // events
          toggle.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            if (childContainer.style.display === 'none') {
              toggle.textContent = '-';
              childContainer.style.display = 'block';
              // loading indicator
              clearElement(childContainer);
              childContainer.appendChild(el('div', { class: 'meta', text: 'Loading...' }));
              try {
                const subPkg = await fetchPackage(reg, d);
                const subDeps = subPkg.dependencies || {};
                clearElement(childContainer);
                if (Object.keys(subDeps).length === 0) {
                  childContainer.appendChild(el('div', { class: 'meta', text: 'No dependencies' }));
                } else {
                  for (const [sd, sv] of Object.entries(subDeps)) {
                    const subRow = el('div', {}, [
                      (() => { const x = document.createElement('input'); x.type = 'checkbox'; x.className='checkbox child-cb'; x.value = sd; x.checked=true; return x; })(),
                      el('span', { class: 'child-name', text: sd }),
                      el('span', { class: 'meta', text: ` ${sv}` })
                    ]);
                    // click to open that package
                    subRow.querySelector('.child-name').style.fontWeight = '600';
                    subRow.querySelector('.child-name').style.cursor = 'pointer';
                    subRow.querySelector('.child-name').addEventListener('click', () => renderPackageView(reg, sd, true));
                    childContainer.appendChild(subRow);
                  }
                }
              } catch (e) {
                clearElement(childContainer);
                childContainer.appendChild(el('div', { class: 'error-panel', text: e.message || 'Error' }));
              }
            } else {
              toggle.textContent = '+';
              childContainer.style.display = 'none';
            }
          });

          nameEl.addEventListener('click', () => renderPackageView(reg, d, true));

          depsList.appendChild(depRow);
        }
      }

      pack.appendChild(depsList);

      // control buttons
      const controls = el('div', {}, [
        el('button', { id: 'download-selected', text: 'Download selected dependencies' }),
        el('button', { id: 'download-recursive', text: 'Download all recursively' })
      ]);
      pack.appendChild(controls);

      output.appendChild(pack);

      // wire up buttons after appended
      document.getElementById('btn-download').addEventListener('click', () => downloadTarball(data, name));

      // select all behavior
      selectAllCheckbox.addEventListener('change', (e) => {
        const checks = depsList.querySelectorAll('.checkbox');
        checks.forEach(c => c.checked = e.target.checked);
      });

      // download selected
      const dlSelBtn = document.getElementById('download-selected');
      dlSelBtn.addEventListener('click', async () => {
        const checks = depsList.querySelectorAll('.checkbox:checked');
        if (!checks.length) { setStatus('No dependencies selected', true); return; }
        setStatus('Queuing selected downloads...');
        for (const c of checks) {
          const nm = c.value;
          try {
            const pkg = await fetchPackage(reg, nm).catch(()=>null);
            if (pkg) downloadTarball(pkg, nm);
          } catch (e) { console.warn('dl sel err', e); }
        }
        setStatus('Selected downloads queued');
      });

      // download recursive
      document.getElementById('download-recursive').addEventListener('click', async () => {
        if (isDownloadingRecursive) { setStatus('Already downloading...', true); return; }
        isCancelling = false;
        isDownloadingRecursive = true;
        progressArea.style.display = 'block';
        progressText.textContent = '0 / 0';
        progressBar.style.width = '0%';
        progressRemaining.textContent = 'Осталось: 0';
        cancelDownloadBtn.disabled = false;

        try {
          setStatus('Resolving dependency graph...');
          const setToDownload = await collectRecursiveDependencies(reg, name);
          const arr = Array.from(setToDownload);
          if (arr.length === 0) {
            setStatus('No dependencies to download');
            isDownloadingRecursive = false;
            progressArea.style.display = 'none';
            return;
          }
          const total = arr.length;
          let done = 0;
          progressText.textContent = `${done} / ${total}`;
          progressBar.style.width = '0%';
          progressRemaining.textContent = `Осталось: ${total - done}`;
          setStatus(`Downloading ${total} packages...`);

          for (const nm of arr) {
            if (isCancelling) break;
            try {
              const pkg = await fetchPackage(reg, nm).catch(()=>null);
              if (pkg) {
                await new Promise((resolve) => {
                  chrome.downloads.download({ url: pkg.dist?.tarball, filename: `${nm}.tgz` }, () => resolve());
                });
              }
            } catch (e) { console.warn('fetch/dl err', e); }
            done++;
            const pct = Math.round((done / total) * 100);
            progressText.textContent = `${done} / ${total}`;
            progressBar.style.width = `${pct}%`;
            progressRemaining.textContent = `Осталось: ${Math.max(total - done, 0)}`;
          }

          if (isCancelling) setStatus(`Cancelled by user. Downloaded ${Math.min(done, total)} of ${total}.`);
          else setStatus(`Done. Downloaded ${Math.min(done, total)} packages.`);
        } catch (e) {
          console.error(e);
          setStatus('Error during recursive download', true);
          showErrorPanel(e.message || String(e));
        } finally {
          isDownloadingRecursive = false;
          cancelDownloadBtn.disabled = true;
          setTimeout(()=>{ progressArea.style.display = 'none'; }, 2200);
        }
      });

      // cancel button
      cancelDownloadBtn.addEventListener('click', () => {
        if (!isDownloadingRecursive) return;
        isCancelling = true;
        cancelDownloadBtn.disabled = true;
        setStatus('Cancellation requested — finishing current download (if any)...');
      });

    } catch (err) {
      console.error(err);
      showErrorPanel(err.message || String(err));
      setStatus('Error', true);
    }
  }

  // BFS collect recursive deps
  async function collectRecursiveDependencies(reg, rootName) {
    const q = [rootName];
    const seen = new Set([rootName]);
    while (q.length) {
      const cur = q.shift();
      try {
        const pkg = await fetchPackage(reg, cur).catch(()=>null);
        if (!pkg) continue;
        const deps = pkg.dependencies || {};
        for (const d of Object.keys(deps)) {
          if (!seen.has(d)) { seen.add(d); q.push(d); }
        }
      } catch (e) { console.warn('collect err', e); }
    }
    seen.delete(rootName);
    return seen;
  }

  // Graph building + rendering via d3 (if available)
  async function buildGraphFromCurrent() {
    const cur = output._current;
    if (!cur) { setStatus('Nothing to graph', true); return; }
    const reg = cur.reg;
    const maxNodes = 200;
    const nodes = [];
    const links = [];
    const idx = new Map();
    const q = [cur.name];
    const seen = new Set([cur.name]);

    while (q.length && nodes.length < maxNodes) {
      const n = q.shift();
      if (!idx.has(n)) { idx.set(n, nodes.length); nodes.push({ id: n }); }
      try {
        const pkg = runtimeCache[makeKey(reg,n)] || await fetchPackage(reg, n).catch(()=>null);
        if (!pkg) continue;
        const deps = pkg.dependencies || {};
        for (const d of Object.keys(deps)) {
          if (!idx.has(d)) { idx.set(d, nodes.length); nodes.push({ id: d }); }
          links.push({ source: n, target: d });
          if (!seen.has(d) && nodes.length < maxNodes) { seen.add(d); q.push(d); }
        }
      } catch (e) { console.warn('graph fetch err', e); }
    }

    renderD3(nodes, links);
  }

  function renderD3(nodes, links) {
    if (typeof d3 === 'undefined') { setStatus('d3 not available (place libs/d3.v7.min.js)', true); return; }
    graphArea.style.display = 'block';
    // clear svg children
    while (graphSvg.firstChild) graphSvg.removeChild(graphSvg.firstChild);
    const width = graphSvg.clientWidth || 600;
    const height = graphSvg.clientHeight || 400;
    const svg = d3.select('#graph').attr('viewBox', [0,0,width,height]);

    const simulation = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.id).distance(60).strength(0.7))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width/2, height/2));

    const link = svg.append('g')
      .attr('stroke','#999')
      .attr('stroke-opacity',0.6)
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke-width',1);

    const node = svg.append('g')
      .attr('stroke','#fff')
      .attr('stroke-width',1.2)
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r',8)
      .call(d3.drag()
        .on('start', (event, d)=> { if (!event.active) simulation.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag', (event, d)=> { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d)=> { if (!event.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; })
      );

    const labels = svg.append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text(d => d.id)
      .attr('font-size', 10)
      .attr('dx', 10)
      .attr('dy', 3);

    node.append('title').text(d => d.id);

    simulation.on('tick', ()=> {
      link
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => d.target.x)
        .attr('y2', d => d.target.y);

      node.attr('cx', d => d.x).attr('cy', d => d.y);
      labels.attr('x', d => d.x).attr('y', d => d.y);
    });
  }

  // UI wiring
  searchBtn.addEventListener('click', () => {
    const name = pkgEl.value.trim();
    if (!name) { setStatus('Enter package name', true); return; }
    historyStack = [];
    backBtn.style.display = 'none';
    renderPackageView(registryEl.value.trim() || 'https://registry.npmjs.org/', name, false);
  });

  pkgEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchBtn.click(); });

  backBtn.addEventListener('click', () => {
    if (historyStack.length === 0) return;
    const prev = historyStack.pop();
    renderPackageView(prev.reg, prev.name, false);
    if (historyStack.length === 0) backBtn.style.display = 'none';
  });

  clearCacheBtn.addEventListener('click', async () => {
    runtimeCache = {};
    await storageRemove(STORAGE_KEY).catch(()=>{});
    setStatus('Cache cleared');
  });

  showGraphBtn.addEventListener('click', async () => {
    await buildGraphFromCurrent();
  });

  closeGraphBtn.addEventListener('click', () => {
    graphArea.style.display = 'none';
  });

});
