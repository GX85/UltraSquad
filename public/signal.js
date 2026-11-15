(function () {
  'use strict';
  const canvas = document.querySelector('#signal-canvas');
  const context = canvas.getContext('2d');
  let buckets = Array.from({ length: 36 }, () => [0, 0]);
  let peak = 1;
  let width = 0;
  let height = 0;

  function draw() {
    if (!width || !height) return;
    context.clearRect(0, 0, width, height);
    const left = 20;
    const right = width - 12;
    const top = 18;
    const baseline = height - 27;
    const spacing = (right - left) / buckets.length;
    context.font = '10px "JetBrains Mono", Consolas, monospace';
    context.strokeStyle = '#252525';
    context.lineWidth = 1;
    for (let index = 0; index <= 3; index++) {
      const y = Math.round(top + (baseline - top) * index / 3) + .5;
      context.beginPath();
      context.moveTo(left, y);
      context.lineTo(right, y);
      context.stroke();
    }
    context.fillStyle = '#777';
    context.fillText(String(peak), 0, top + 3);
    buckets.forEach(([total, alerts], index) => {
      if (!total) return;
      const x = left + index * spacing + spacing * .15;
      const unit = (baseline - top) / peak;
      const barWidth = spacing * .7;
      context.fillStyle = '#666';
      context.fillRect(x, baseline - total * unit, barWidth, total * unit);
      if (alerts) {
        context.fillStyle = '#eee';
        context.fillRect(x, baseline - total * unit, barWidth, alerts * unit);
      }
    });
    context.fillStyle = '#888';
    context.fillText('−18 мин', left, height - 6);
    context.textAlign = 'right';
    context.fillText('сейчас', right, height - 6);
    context.textAlign = 'left';
  }
  new ResizeObserver(() => {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width || !height) return;
    const scale = devicePixelRatio || 1;
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    draw();
  }).observe(canvas);
  window.updateSignal = events => {
    const now = Math.floor(Date.now() / 30000);
    buckets = Array.from({ length: 36 }, () => [0, 0]);
    for (const event of events) {
      const index = Math.floor(Date.parse(event.time) / 30000) - now + 35;
      if (index < 0 || index >= buckets.length) continue;
      buckets[index][0]++;
      if (event.agent) buckets[index][1]++;
    }
    peak = Math.max(1, ...buckets.map(bucket => bucket[0]));
    canvas.setAttribute('aria-label', 'События за последние 18 минут. Всего ' + buckets.reduce((sum, bucket) => sum + bucket[0], 0) + ', сигналов ' + buckets.reduce((sum, bucket) => sum + bucket[1], 0) + '.');
    draw();
  };
})();