#!/usr/bin/env python3
"""Build a synthetic Google Takeout (Fitbit / Google Health) export zip for testing the parser.
Mirrors the Takeout layout: Takeout/Fitbit/Global Export Data/*.json + CSV folders.
Intraday timestamps are written in UTC (as in real Takeout); daily files are local dates."""
import csv, io, json, random, sys, zipfile
from datetime import date, datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/synthetic_takeout.zip'
start, ndays = date(2026, 9, 1), 21
random.seed(7)
F = 'Takeout/Fitbit/'
expected = {}
z = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
mdY = lambda dt: dt.strftime('%m/%d/%y %H:%M:%S')

steps_all, hr_all, cal_all, rhr, sed, very, mod, light, sleeps = [], [], [], [], [], [], [], [], []
hrv_rows, ready_rows, spo2_rows, score_rows, hrv_detail = [], [], [], [], []
for i in range(ndays):
    d = start + timedelta(days=i)
    total = 0
    for h in range(7, 22):  # IST hours with movement
        for m in range(0, 60, 5):
            v = random.randint(20, 120)
            total += v
            t = datetime(d.year, d.month, d.day, h, m, tzinfo=IST).astimezone(timezone.utc)
            steps_all.append({'dateTime': mdY(t), 'value': str(v)})
            cal_all.append({'dateTime': mdY(t), 'value': '6.2'})
            hr_all.append({'dateTime': mdY(t), 'value': {'bpm': random.randint(62, 118), 'confidence': 2}})
    r = round(58 + random.random() * 4, 2)
    rhr.append({'dateTime': mdY(datetime(d.year, d.month, d.day)), 'value': {'date': d.strftime('%m/%d/%y'), 'value': r, 'error': 6.5}})
    dm = mdY(datetime(d.year, d.month, d.day))
    sed.append({'dateTime': dm, 'value': '700'}); very.append({'dateTime': dm, 'value': str(20 + i)}); mod.append({'dateTime': dm, 'value': '15'}); light.append({'dateTime': dm, 'value': '210'})
    bed = datetime(d.year, d.month, d.day, 23, 20) - timedelta(days=1) + timedelta(minutes=random.randint(-30, 40))
    asleep = random.randint(380, 460); wake = 50
    end = bed + timedelta(minutes=asleep + wake)
    deep, rem = int(asleep * .17), int(asleep * .22)
    log_id = 40000000000 + i
    sleeps.append({'logId': log_id, 'dateOfSleep': d.isoformat(), 'startTime': bed.strftime('%Y-%m-%dT%H:%M:%S.000'), 'endTime': end.strftime('%Y-%m-%dT%H:%M:%S.000'),
                   'duration': (asleep + wake) * 60000, 'minutesToFallAsleep': 0, 'minutesAsleep': asleep, 'minutesAwake': wake, 'minutesAfterWakeup': 0, 'timeInBed': asleep + wake,
                   'efficiency': 90, 'type': 'stages', 'infoCode': 0, 'logType': 'auto_detected',
                   'levels': {'summary': {'deep': {'count': 4, 'minutes': deep, 'thirtyDayAvgMinutes': 70}, 'wake': {'count': 20, 'minutes': wake, 'thirtyDayAvgMinutes': 50},
                                          'light': {'count': 25, 'minutes': asleep - deep - rem, 'thirtyDayAvgMinutes': 250}, 'rem': {'count': 6, 'minutes': rem, 'thirtyDayAvgMinutes': 90}},
                              'data': [{'dateTime': bed.strftime('%Y-%m-%dT%H:%M:%S.000'), 'level': 'wake', 'seconds': 300}], 'shortData': []}, 'mainSleep': True})
    score = random.randint(70, 88)
    score_rows.append([log_id, end.replace(tzinfo=IST).astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), score, 20, 18, 40, deep, int(r), 0.08])
    hv = round(35 + random.random() * 15, 1)
    hrv_rows.append([d.isoformat() + 'T00:00:00', hv, 61.2, 2.3])
    for k in range(6):
        hrv_detail.append([(bed + timedelta(minutes=60 + 5 * k)).strftime('%Y-%m-%dT%H:%M:%S'), hv + 1, 0.9, 900.5, 450.2])
    rd = random.randint(50, 90)
    ready_rows.append([d.isoformat(), rd, 'HIGH' if rd >= 70 else 'MODERATE', 0, 80, 70, '', 'GOOD', 'GOOD'])
    spo2_rows.append([d.isoformat() + 'T07:00:00', 96.4, 94.1, 98.7])
    expected[d.isoformat()] = {'steps': total, 'resting_hr': round(r, 1), 'hrv': hv, 'sleep_minutes': asleep, 'sleep_score': score, 'readiness': rd, 'very_active': 20 + i}

def jdump(name, data): z.writestr(F + 'Global Export Data/' + name, json.dumps(data))
# Takeout splits intraday files by month/day; emulate a couple of chunks.
jdump('steps-2026-09-01.json', steps_all[: len(steps_all) // 2]); jdump('steps-2026-09-11.json', steps_all[len(steps_all) // 2:])
jdump('calories-2026-09-01.json', cal_all)
jdump('heart_rate-2026-09-01.json', hr_all)
jdump('resting_heart_rate-2026-09-01.json', rhr)
jdump('sedentary_minutes-2026-09-01.json', sed); jdump('very_active_minutes-2026-09-01.json', very)
jdump('moderately_active_minutes-2026-09-01.json', mod); jdump('lightly_active_minutes-2026-09-01.json', light)
jdump('sleep-2026-09-01.json', sleeps)

def cdump(path, header, rows):
    b = io.StringIO(); w = csv.writer(b); w.writerow(header); w.writerows(rows); z.writestr(F + path, b.getvalue())
cdump('Sleep/sleep_score.csv', ['sleep_log_entry_id', 'timestamp', 'overall_score', 'composition_score', 'revitalization_score', 'duration_score', 'deep_sleep_in_minutes', 'resting_heart_rate', 'restlessness'], score_rows)
cdump('Heart Rate Variability/Daily Heart Rate Variability Summary - 2026-09-(01).csv', ['timestamp', 'rmssd', 'nremhr', 'entropy'], hrv_rows)
cdump('Heart Rate Variability/Heart Rate Variability Details - 2026-09-01.csv', ['timestamp', 'rmssd', 'coverage', 'low_frequency', 'high_frequency'], hrv_detail)
cdump('Daily Readiness/Daily Readiness Score - 2026-09-(01).csv', ['date', 'readiness_score_value', 'readiness_state', 'activity_subcomponent', 'sleep_subcomponent', 'hrv_subcomponent', 'activity_state', 'sleep_state', 'hrv_state'], ready_rows)
cdump('Oxygen Saturation (SpO2)/Daily SpO2 - 2026-09-01-2026-09-21.csv', ['timestamp', 'average_value', 'lower_bound', 'upper_bound'], spo2_rows)
z.writestr(F + 'Personal & Account/Profile.csv', 'id,first_name\nX,Test\n')
z.writestr(F + 'Physical Activity/exercise-0.json', json.dumps([{'logId': 1, 'activityName': 'Walk', 'startTime': '09/02/26 07:00:00'}]))
z.writestr('Takeout/archive_browser.html', '<html></html>')
z.close()
json.dump(expected, open(out.replace('.zip', '.expected.json'), 'w'), indent=1)
print(out, len(expected), 'days')

# Legacy "Export a selection" CSV
sel = out.replace('.zip', '_selection.csv')
with open(sel, 'w') as f:
    f.write('Activities\nDate,Calories Burned,Steps,Distance,Floors,Minutes Sedentary,Minutes Lightly Active,Minutes Fairly Active,Minutes Very Active,Activity Calories\n')
    f.write('"22-09-2026","2,310","11,204","8.1","9","650","220","18","40","1,050"\n'.replace('22-09-2026', '2026-09-22'))
    f.write('\nSleep\nStart Time,End Time,Minutes Asleep,Minutes Awake,Number of Awakenings,Time in Bed,Minutes REM Sleep,Minutes Light Sleep,Minutes Deep Sleep\n')
    f.write('"2026-09-21 11:05PM","2026-09-22 6:50AM","410","55","18","465","95","240","75"\n')
print(sel)
