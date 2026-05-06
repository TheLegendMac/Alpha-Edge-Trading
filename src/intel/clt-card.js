// Central Limit Theorem (Mean Convergence) home-card.
// Visualizes how the sample mean (avg R) converges on the true edge as N grows,
// with a 95% CI for the true mean using SE = sd / sqrt(n).

function buildCltCard(closedWithPL, help) {
  const n = closedWithPL.length;
  const empty = n < 2;
  const head = `
    <div class="home-card-title" style="margin: 0 0 6px;">Central Limit Theorem · Mean Convergence${help(
      'As your sample size grows, the average outcome converges on your true edge. ' +
      'The 95% confidence interval narrows by roughly 1/√N — doubling trades shrinks the band by ~30%.'
    )}</div>
    <div style="font-family: var(--mono); font-size: 11px; color: var(--ink-4); margin-bottom: 10px;">How tight is your edge estimate? Wider band = noisier sample.</div>`;

  if (empty) {
    return `<div class="home-card clt-card">
      ${head}
      <div class="clt-card-empty">Need at least 2 closed trades to estimate the mean and confidence band.</div>
    </div>`;
  }

  const rs = closedWithPL.map(x => x.r || 0);
  const mean = rs.reduce((s, x) => s + x, 0) / n;
  // Sample standard deviation (n-1 denominator)
  const variance = n > 1 ? rs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);
  const ciHalf = 1.96 * se;
  const ciLow = mean - ciHalf;
  const ciHigh = mean + ciHalf;

  // CI bar visualization: scale around max(|ciLow|,|ciHigh|, 1.0R)
  const span = Math.max(Math.abs(ciLow), Math.abs(ciHigh), 1.0);
  const xMin = -span * 1.1;
  const xMax =  span * 1.1;
  const toPct = v => ((v - xMin) / (xMax - xMin)) * 100;
  const zeroPct = toPct(0);
  const lowPct = toPct(ciLow);
  const highPct = toPct(ciHigh);
  const meanPct = toPct(mean);
  const containsZero = ciLow <= 0 && ciHigh >= 0;
  const verdict = containsZero
    ? `<span style="color:var(--amber-bright);">Edge not yet significant</span> — sample is too small to rule out zero.`
    : (mean > 0
      ? `<span style="color:var(--green-bright);">Edge is statistically positive</span> at 95% confidence.`
      : `<span style="color:var(--red-bright);">Edge is statistically negative</span> at 95% confidence.`);

  // Convergence projection: at 30, 60, 100, 250 trades — show how SE shrinks (assuming current sd holds)
  const targets = [30, 60, 100, 250];
  const seAt = k => sd / Math.sqrt(k);
  const halfAt = k => 1.96 * seAt(k);
  const widest = halfAt(Math.min(...targets, n));
  const convRows = targets.map(k => {
    const half = halfAt(k);
    const width = (half / widest) * 100;
    const isNow = k <= n && (targets.indexOf(k) === 0 || targets[targets.indexOf(k) - 1] < n);
    return `<div class="clt-converge-row ${k <= n ? 'now' : ''}">
      <div>n=${k}</div>
      <div class="clt-conv-bar-wrap"><div class="clt-conv-bar-fill" style="width:${Math.max(4, width).toFixed(0)}%"></div></div>
      <div style="text-align:right;">±${half.toFixed(2)}R</div>
    </div>`;
  }).join('');

  return `<div class="home-card clt-card">
    ${head}
    <div class="clt-row">
      <div>
        <div class="clt-stat-grid">
          <div class="clt-stat">
            <div class="clt-stat-label">Sample Mean (R)</div>
            <div class="clt-stat-value ${mean > 0 ? 'pos' : mean < 0 ? 'neg' : ''}">${mean >= 0 ? '+' : ''}${mean.toFixed(2)}R</div>
            <div class="clt-stat-sub">${n} closed trades</div>
          </div>
          <div class="clt-stat">
            <div class="clt-stat-label">Std Error</div>
            <div class="clt-stat-value">±${se.toFixed(2)}R</div>
            <div class="clt-stat-sub">SD ${sd.toFixed(2)}R / √${n}</div>
          </div>
          <div class="clt-stat" style="grid-column: 1 / -1;">
            <div class="clt-stat-label">95% Confidence Interval for True Mean</div>
            <div class="clt-stat-value">${ciLow >= 0 ? '+' : ''}${ciLow.toFixed(2)}R &nbsp;to&nbsp; ${ciHigh >= 0 ? '+' : ''}${ciHigh.toFixed(2)}R</div>
            <div class="clt-ci-bar-wrap">
              <div class="clt-ci-zero" style="left:${zeroPct.toFixed(2)}%"></div>
              <div class="clt-ci-band" style="left:${lowPct.toFixed(2)}%; width:${(highPct - lowPct).toFixed(2)}%;"></div>
              <div class="clt-ci-mean" style="left:${meanPct.toFixed(2)}%"></div>
            </div>
            <div class="clt-ci-labels"><span>${xMin.toFixed(2)}R</span><span>0</span><span>+${xMax.toFixed(2)}R</span></div>
          </div>
        </div>
      </div>
      <div>
        <div class="clt-stat-label">Projected band width as N grows</div>
        <div class="clt-converge-list">${convRows}</div>
        <div class="clt-explainer">${verdict}<br/><br/>
          <strong>Why this matters:</strong> The CLT says the mean of any sample tends toward the true population mean as N grows, with error shrinking ∝ 1/√N. A wide band means a few more trades could change your verdict — keep sample size in mind before scaling size or killing a setup.
        </div>
      </div>
    </div>
  </div>`;
}

window.buildCltCard = buildCltCard;
