
/* ================= HARNESS ================= */
const _fs = require('fs');
const _YEAR = process.env.SERA_YEAR || '2026';
const _root_raw0 = JSON.parse(_fs.readFileSync('d:/projects/yigit_platform/data/sera-butce-web/server/data.json','utf8'));
let _raw = _root_raw0.personal['sera_butce_state_v1'];
if (typeof _raw === 'object') _raw = Object.keys(_raw).sort((a,b)=>a-b).map(k=>_raw[k]).join('');
const _root = JSON.parse(_raw);
const _st = Object.assign({}, _root.yearsData[_YEAR], { year: Number(_YEAR) });

const _mp = buildMonthlyProductionFromWeekly(_st);
const _pool = {};
MONTHS.forEach(function(m){ _pool[m.key] = pool770ForMonth(_st, m.key); });

const _rows = [['block','month','production_kg','rev_export','rev_kapi','rev_domestic','rev_totalUSD','personnel_ex770','pool770_share','fertilizer','sarf','gen_710','gen_720','gen_730','gen_750','gen_760','gen_770manual','yonetim770','general_total','expense_total']];
let _tp=0,_tr=0,_te=0,_td=0,_tf=0,_ts=0,_t730=0,_t760=0,_ty=0,_tpool=0,_tpers=0;
BLOCKS.forEach(function(b){
  MONTHS.forEach(function(m){
    const qty = (_mp[b.key]||{})[m.key] || 0;
    const crop = getCropForBlockMonth(_st, b.key, m.key);
    const rev = calculateMonthlyRevenue(qty, m.key, crop);
    const exp = calculateMonthlyExpense(_st, b.key, m.key, _pool[m.key]);
    const bd  = generalExpenseBreakdownForBlockMonth(_st, b.key, m.key);
    const rawP = rawPersonnelCostByCode(_st, b.key, m.key);
    let pEx = 0; PERSONNEL_CODES.forEach(function(c){ if (c !== POOL_CODE) pEx += rawP[c]||0; });
    const share = pool770ShareForBlock(_st, b.key, _pool[m.key], m.key);
    const r = [b.key,m.key,qty,rev.totalUSD-rev.kapi,rev.kapi,rev.domestic,rev.totalUSD,pEx,share,
      exp.fertilizer,exp.sarf,bd['710'],bd['720'],bd['730'],bd['750'],bd['760'],bd['770'],bd.yonetim770,exp.general,exp.total];
    _rows.push(r.map(function(v){ return typeof v==='number' ? Math.round(v*100)/100 : v; }));
    _tp+=qty; _tr+=rev.totalUSD; _te+=exp.total; _td+=rev.domestic;
    _tf+=exp.fertilizer; _ts+=exp.sarf; _t730+=bd['730']; _t760+=bd['760']; _ty+=bd.yonetim770; _tpool+=share; _tpers+=pEx;
  });
});
_fs.writeFileSync('golden-'+_YEAR+'.csv', _rows.map(function(r){return r.join(',');}).join('\n'));
const N = function(v){ return Math.round(v).toLocaleString('en-US'); };
console.log('YEAR', _YEAR, '| blocks', BLOCKS.length, '| rows', _rows.length-1);
console.log('production        ', N(_tp));
console.log('revenue USD       ', N(_tr));
console.log('domestic (DTM)    ', N(_td));
console.log('expense USD       ', N(_te));
console.log('  personnel ex770 ', N(_tpers));
console.log('  770 pool share  ', N(_tpool));
console.log('  fertilizer 710  ', N(_tf));
console.log('  sarf 710        ', N(_ts));
console.log('  730             ', N(_t730));
console.log('  760             ', N(_t760));
console.log('  770 yonetim     ', N(_ty));
console.log('profit            ', N(_tr-_te));
console.log('margin %          ', (100*(_tr-_te)/_tr).toFixed(1));
