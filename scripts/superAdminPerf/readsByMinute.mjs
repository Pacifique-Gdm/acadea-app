// Lectures Firestore du STAGING minute par minute (Cloud Monitoring, lecture seule).
//   TOKEN=$(gcloud auth print-access-token) node scripts/superAdminPerf/readsByMinute.mjs <début ISO> <fin ISO>
// Sert à attribuer les lectures à chaque étape de mesure, quand chaque étape occupe sa propre minute.
// Attention : toutes les activités du staging pendant ces minutes sont comptées.
const [startIso, endIso] = process.argv.slice(2);
if (!process.env.TOKEN || !startIso || !endIso) throw new Error("Usage : TOKEN=... node readsByMinute.mjs <début ISO> <fin ISO>");
const filter = encodeURIComponent('metric.type="firestore.googleapis.com/document/read_count"');
const params = `filter=${filter}&interval.startTime=${new Date(startIso).toISOString()}&interval.endTime=${new Date(endIso).toISOString()}`
  + "&aggregation.alignmentPeriod=60s&aggregation.perSeriesAligner=ALIGN_SUM&aggregation.crossSeriesReducer=REDUCE_SUM";
const response = await fetch(`https://monitoring.googleapis.com/v3/projects/acadea-staging/timeSeries?${params}`, { headers: { Authorization: `Bearer ${process.env.TOKEN}` } });
const body = await response.json();
if (!response.ok) throw new Error(`Cloud Monitoring : ${response.status} ${body.error?.message ?? ""}`);
const rows = (body.timeSeries ?? []).flatMap((series) => series.points ?? [])
  .map((point) => ({ minute: point.interval.endTime.slice(11, 16), lectures: Number(point.value.int64Value ?? 0) }))
  .sort((a, b) => a.minute.localeCompare(b.minute));
console.log(JSON.stringify(rows));
