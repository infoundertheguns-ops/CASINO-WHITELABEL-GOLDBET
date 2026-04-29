const fs = require('fs');
const path = require('path');

// ── HEALTH ──
try {
  const h = JSON.parse(fs.readFileSync(path.join(__dirname, 'health-result.json'), 'utf8'));
  console.log('═══════════════════════════════════════');
  console.log('  SYSTEM HEALTH');
  console.log('═══════════════════════════════════════');
  if (h.scores) {
    console.log(`  Overall: ${h.scores.overall}/100 (${h.scores.level})`);
    console.log('  Subsystems:');
    for (const [k, v] of Object.entries(h.scores.subsystems || {})) {
      console.log(`    ${v.label || k}: ${v.score}/100 (weight ${v.weight}) — ${v.details || ''}`);
    }
  } else if (h.error) {
    console.log('  ERROR:', h.error);
  } else {
    console.log('  Raw keys:', Object.keys(h));
  }

  if (h.scraper) {
    console.log('\n  Scraper Status:');
    for (const [k, v] of Object.entries(h.scraper)) {
      console.log(`    ${k}: connected=${v.connected}, lastCycle=${v.lastCycleSeconds}s, errors=${v.errorsLastHour}`);
    }
  }
  if (h.redis) {
    console.log(`\n  Redis: connected=${h.redis.connected}, latency=${h.redis.latencyMs}ms`);
  }

  if (h.metrics) {
    const m = h.metrics;
    if (m.events) {
      console.log('\n  Events by source/status:');
      for (const [k, v] of Object.entries(m.events)) {
        console.log(`    ${k}: ${v}`);
      }
    }
    if (m.active) {
      console.log('\n  Active:');
      console.log('    Markets:', JSON.stringify(m.active.markets));
      console.log('    Outcomes total:', m.active.outcomes_total);
    }
    if (m.data_quality) {
      console.log('\n  Data Quality:');
      for (const [k, v] of Object.entries(m.data_quality)) {
        console.log(`    ${k}: ${v}`);
      }
    }
  }
  console.log(`\n  Cached at: ${h.cached_at || 'N/A'}`);
} catch(e) {
  console.log('Health parse error:', e.message);
}

console.log('\n');

// ── COVERAGE ──
try {
  const c = JSON.parse(fs.readFileSync(path.join(__dirname, 'coverage-result.json'), 'utf8'));
  console.log('═══════════════════════════════════════');
  console.log('  MARKET COVERAGE');
  console.log('═══════════════════════════════════════');
  if (c.kpis) {
    const k = c.kpis;
    console.log(`  Total Events: ${k.total_events}`);
    console.log(`  Source Markets: ${k.total_source_markets}`);
    console.log(`  DB Markets: ${k.total_db_markets}`);
    console.log(`  Coverage: ${k.coverage_pct}%`);
    console.log(`  Zero Market Events: ${k.zero_market_events}`);
  } else if (c.error) {
    console.log('  ERROR:', c.error);
  } else {
    console.log('  Raw keys:', Object.keys(c));
  }

  if (c.summary && Array.isArray(c.summary)) {
    console.log('\n  Per-Sport Coverage:');
    console.log('  ' + 'Sport'.padEnd(25) + 'Events'.padEnd(8) + 'AvgSrc'.padEnd(8) + 'AvgDB'.padEnd(8) + 'Cov%'.padEnd(8) + 'Gaps'.padEnd(6) + 'Zero');
    console.log('  ' + '-'.repeat(71));
    for (const s of c.summary) {
      console.log('  ' +
        (s.sport_name || '').padEnd(25) +
        String(s.events || 0).padEnd(8) +
        String(s.avg_source || 0).padEnd(8) +
        String(s.avg_db || 0).padEnd(8) +
        (s.coverage_pct + '%').padEnd(8) +
        String(s.gap_events || 0).padEnd(6) +
        String(s.zero_markets || 0)
      );
    }
  }

  if (c.gap_events && Array.isArray(c.gap_events)) {
    console.log(`\n  Gap Events (top 10 of ${c.gap_events.length}):`);
    for (const g of c.gap_events.slice(0, 10)) {
      console.log(`    ${g.home_team} vs ${g.away_team} — Kambi:${g.source_count} DB:${g.betssolution_count} Gap:${g.gap} (${g.coverage_pct}%)`);
    }
  }

  console.log(`\n  Generated: ${c.generated_at || 'N/A'}`);
} catch(e) {
  console.log('Coverage parse error:', e.message);
}
