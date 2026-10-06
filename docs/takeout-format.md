# Google Health Takeout: real format (export of 6 Oct 2026)

Analysed from `takeout-20261006T130645Z-1-001.zip`, 18:36 IST on 6 Oct 2026. The zip is kept in `data/takeout-raw/` (dir 700, file 600). It holds 496 files, about 73 MB uncompressed and 7.1 MB zipped, all under `Takeout/Google Health/`.
Every value below is either structural (names, keys, counts, date ranges, units) or redacted (digits replaced by `9`). This file holds no personal values.

## 1. Folder tree (files · uncompressed size)

```
Takeout/Google Health/
├── Physical Activity_GoogleData/      86 files · 35.7 MB   ← per-sample CSVs, one sub-folder per family (main data)
├── Health Fitness Data_GoogleData/    50 files · 20.2 MB   ← UserSleeps / UserSleepStages / UserExercises + app/coach tables
├── Global Export Data/                50 files · 16.3 MB   ← legacy Fitbit JSON (monthly files), reconciled steps/distance/calories
├── Account Changes/                   25 files ·  1.2 MB   (personal, skipped)
├── Biometrics/                       234 files ·  3 KB     (Glucose files, all "no data")
├── Paired Devices/                     6 files ·  4 KB     (Trackers.csv, Devices.csv, …)
├── Active Zone Minutes (AZM)/          1 file              (legacy copy of AZM, local stamps)
├── Heart Rate Variability/             4 READMEs only      (no HRV data yet)
├── Oxygen Saturation (SpO2)/           2 READMEs only      (no SpO2 data yet)
├── Daily Readiness/                    README + empty properties file
├── Sleep Score/sleep_score.csv         header only
├── Stress Score/Stress Score.csv       header only
├── Temperature/Device Temperature - …  header only
├── Heart Rate/                         notification settings (empty)
├── Menstrual Health/, Social/, Social_GoogleData/, Stress Journal/, Snore and Noise Detect/,
│   Atrial Fibrillation PPG/, Discover/, Guided Programs/, Fitbit Premium/, Commerce_GoogleData/,
│   Email Notifications Settings_GoogleData/, InAppNotifications_GoogleData/      (READMEs / settings, skipped)
└── Your Profile/, User Profile_GoogleData/, User Security Data/                 (personal, skipped)
```

## 2. Health-relevant families: counts, dates and sources

Dates are the UTC date part of the first and last timestamps. "Sources" counts rows per `data source` value.

| Family | Files | Size | Rows | Dates | Sources (rows) |
|---|---:|---:|---:|---|---|
| Active Zone Minutes (AZM)/Active Zone Minutes - * | 1 | 2.4 KB | 84 | 2026-10-06 – 2026-10-06 |  |
| Daily Readiness/Daily Readiness User Properties - * | 1 | 31 B | 0 |  |  |
| Global Export Data/badge | 1 | 2.6 KB | 6 | 2026-05-20 – 2026-10-06 |  |
| Global Export Data/calories | 6 | 13.0 MB | 219,997 | 2026-05-07 – 2026-10-06 |  |
| Global Export Data/demographic_vo2_max | 1 | 268 B | 1 | 2026-10-06 – 2026-10-06 |  |
| Global Export Data/distance | 6 | 1.6 MB | 27,775 | 2026-05-08 – 2026-10-06 |  |
| Global Export Data/exercise | 1 | 2.1 KB | 1 | 2026-10-06 – 2026-10-06 |  |
| Global Export Data/height | 1 | 178 B | 3 | 2026-05-08 – 2026-10-06 |  |
| Global Export Data/lightly_active_minutes | 6 | 10.4 KB | 180 | 2026-05-07 – 2026-11-02 |  |
| Global Export Data/moderately_active_minutes | 6 | 10.1 KB | 180 | 2026-05-07 – 2026-11-02 |  |
| Global Export Data/resting_heart_rate | 1 | 41.6 KB | 365 | 2026-05-07 – 2027-05-06 |  |
| Global Export Data/sedentary_minutes | 6 | 10.6 KB | 180 | 2026-05-07 – 2026-11-02 |  |
| Global Export Data/steps | 6 | 1.6 MB | 27,775 | 2026-05-08 – 2026-10-06 |  |
| Global Export Data/swim_lengths_data | 1 | 177 B | 1 | 2026-10-06 – 2026-10-06 |  |
| Global Export Data/very_active_minutes | 6 | 10.1 KB | 180 | 2026-05-07 – 2026-11-02 |  |
| Global Export Data/weight | 2 | 268 B | 2 | 2026-05-08 – 2026-06-08 |  |
| Health Fitness Data_GoogleData/CalibrationStatusForReadinessAndLoad README | 1 | 798 B | 0 |  |  |
| Health Fitness Data_GoogleData/CalibrationStatusForReadinessAndLoad | 1 | 138 B | 1 |  |  |
| Health Fitness Data_GoogleData/UserExercises | 1 | 5.0 KB | 17 | 2026-05-12 – 2026-10-06 |  |
| Health Fitness Data_GoogleData/UserSleepStages | 1 | 339 B | 1 | 2026-05-20 – 2026-05-20 | DERIVED 1 |
| Health Fitness Data_GoogleData/UserSleeps | 1 | 444 B | 1 | 2026-05-20 – 2026-05-20 | MANUAL 1 |
| Paired Devices/Devices.csv | 1 | 215 B | 2 |  |  |
| Paired Devices/Trackers.csv | 1 | 872 B | 2 | 2026-05-08 – 2026-10-06 |  |
| Physical Activity_GoogleData/Active Energy Burned | 7 | 1.5 MB | 27,903 | 2026-05-08 – 2026-10-06 | Google Health App 27,903 |
| Physical Activity_GoogleData/Active Minutes | 6 | 1.1 MB | 24,463 | 2026-05-08 – 2026-09-30 | Google Health App 24,463 |
| Physical Activity_GoogleData/Active Zone Minutes | 2 | 5.7 KB | 101 | 2026-10-06 – 2026-10-06 | Google Fitbit Air 101 |
| Physical Activity_GoogleData/Activity Level | 7 | 1.5 MB | 27,905 | 2026-05-08 – 2026-10-06 | Google Health App 27,905 |
| Physical Activity_GoogleData/Body Temperature | 2 | 25.0 KB | 555 | 2026-10-06 – 2026-10-06 | Google Fitbit Air 555 |
| Physical Activity_GoogleData/Calories | 7 | 9.2 MB | 207,905 | 2026-05-08 – 2026-10-06 | Google Health App 203,444; Fit Health Connect 4,461 |
| Physical Activity_GoogleData/Calories In Heart Rate Zone | 7 | 17.5 MB | 217,287 | 2026-05-08 – 2026-10-06 | Google Health App 217,287 |
| Physical Activity_GoogleData/Cardio Load | 2 | 5.5 KB | 85 | 2026-10-06 – 2026-10-06 | Google Fitbit Air 85 |
| Physical Activity_GoogleData/Cardio Load Observed Interval | 2 | 806 B | 1 | 2026-10-06 – 2026-10-06 | Google Health App 1 |
| Physical Activity_GoogleData/Coarse Physical Location | 2 | 3.5 KB | 8 | 2026-10-06 – 2026-10-06 | Google Health App 8 |
| Physical Activity_GoogleData/Daily Heart Rate Zones | 2 | 63.3 KB | 152 | 2026-05-08 – 2026-10-06 | Google Health App 152 |
| Physical Activity_GoogleData/Daily Resting Heart Rate | 2 | 565 B | 1 | 2026-10-06 – 2026-10-06 | Google Health App 1 |
| Physical Activity_GoogleData/Distance | 8 | 2.0 MB | 43,140 | 2026-04-09 – 2026-10-06 | Google Health App 25,349; Fit Health Connect 17,663; Google Fitbit Air 128 |
| Physical Activity_GoogleData/Heart Rate | 2 | 685.4 KB | 15,394 | 2026-10-06 – 2026-10-06 | Google Fitbit Air 15,394 |
| Physical Activity_GoogleData/Height | 2 | 672 B | 3 | 2026-05-08 – 2026-10-06 | Google Health App 3 |
| Physical Activity_GoogleData/Live Pace | 2 | 123.2 KB | 2,651 | 2026-10-06 – 2026-10-06 | Google Fitbit Air 2,651 |
| Physical Activity_GoogleData/Micro Motion | 2 | 16.2 KB | 100 | 2026-10-06 – 2026-10-06 | Google Fitbit Air 100 |
| Physical Activity_GoogleData/Micro Stillness | 2 | 30.0 KB | 654 | 2026-10-06 – 2026-10-06 | Google Health App 654 |
| Physical Activity_GoogleData/Nutrition Log | 2 | 21.8 KB | 42 |  | Google Health App 42 |
| Physical Activity_GoogleData/Sedentary Period | 2 | 913 B | 6 |  | Google Health App 6 |
| Physical Activity_GoogleData/Steps | 8 | 1.7 MB | 44,219 | 2026-04-08 – 2026-10-06 | MobileTrack 25,407; Fit Health Connect 18,686; Google Fitbit Air 126 |
| Physical Activity_GoogleData/Swim Lengths Data | 2 | 836 B | 1 | 2026-10-06 – 2026-10-06 | Google Fitbit Air 1 |
| Physical Activity_GoogleData/Time In Heart Rate Zone | 2 | 25.9 KB | 553 | 2026-10-06 – 2026-10-06 | Google Health App 553 |
| Physical Activity_GoogleData/Weather Forecast | 2 | 236.4 KB | 8 | 2026-10-06 – 2026-10-06 | Google Health App 8 |
| Physical Activity_GoogleData/Weight | 2 | 696 B | 4 | 2026-05-08 – 2026-10-06 | Google Health App 3; Fit Health Connect 1 |
| Sleep Score/sleep_score.csv | 1 | 151 B | 0 |  |  |
| Stress Score/Stress Score.csv | 1 | 168 B | 0 |  |  |
| Temperature/Device Temperature - * | 1 | 37 B | 0 |  |  |

## 3. Per-family format

### 3.1 `Physical Activity_GoogleData/<Family>/<family>_YYYY-MM-DD.csv`

- Each file covers one month and is named after its first day. Some families have a single undated file (e.g. `weight.csv`, `daily_resting_heart_rate.csv`).
- Columns are `timestamp, <value columns…>, data source`.
- `timestamp` is **UTC** ISO 8601 with a `Z` suffix, e.g. `9999-99-99T99:99:99Z`. Some families have fractional seconds: `.999Z` for Steps and Distance, `.999999Z` for Weight.
- **Daily** families (Daily Resting Heart Rate, Daily Heart Rate Zones) use `…T00:00:00Z` to mean the **local calendar date**, not midnight UTC.

| Family | Value columns (units) | Granularity | Used |
|---|---|---|---|
| Steps | `steps` (count) | per minute; phone and band rows overlap | yes, as a fallback when Global Export has no steps for that day |
| Distance | `distance` (**metres**) | per minute | yes, as a fallback |
| Calories | `calories` (kcal, includes BMR) | per minute | yes, as a fallback |
| Active Minutes | `light, moderate, very` (0/1 per minute) | per minute | yes, as a fallback for the daily JSON |
| Active Zone Minutes | `heart rate zone` (FAT_BURN/CARDIO/PEAK), `total minutes` (1 fat-burn, 2 cardio/peak) | per minute | yes, daily sum = AZM |
| Heart Rate | `beats per minute` (float) | about every 5 s while worn | yes: daily avg/min/max/samples, band first |
| Daily Resting Heart Rate | `beats per minute` | daily | yes |
| Body Temperature | `temperature celsius` (wrist skin) | per minute while worn | yes: daily mean as `skin_temp_c` |
| Weight | `weight grams` | per log | yes, converted to kg (latest per day) |
| Height | `height millimeters` | per log | no (profile) |
| Live Pace | `steps, distance millimeters, altitude gain millimeters` | band, during walks | **no**: it repeats the band's steps and would double count |
| Active Energy Burned | `Kilocalories` | per minute | no: a subset of Calories |
| Activity Level | `level` (SEDENTARY/LIGHTLY_ACTIVE/…) | per minute | no: the minute totals come from Active Minutes / JSON |
| Calories / Time In Heart Rate Zone | `heart rate zone type, kcal` | per minute | no: 17.5 MB, derived |
| Daily Heart Rate Zones | `heart_rate_zone` (JSON zone thresholds) | daily | no |
| Cardio Load (+ Observed Interval) | `workout, background, total` | per minute, band | no (calibrating; 1 day) |
| Sedentary Period | `start time, end time` | periods | no |
| Swim Lengths Data, Micro Motion, Micro Stillness | sensor detail | | no |
| Weather Forecast, Coarse Physical Location, Nutrition Log | not health metrics / location | | no (privacy) |

Sample rows (redacted):
```
timestamp,steps,data source
9999-99-99T99:99:99.999Z,99,Fit Health Connect
timestamp,beats per minute,data source
9999-99-99T99:99:99Z,999.9,Google Fitbit Air
timestamp,heart rate zone,total minutes,data source
9999-99-99T99:99:99Z,FAT_BURN,9,Google Fitbit Air
```

### 3.2 `Health Fitness Data_GoogleData/*.csv` (each with a `… README`)

- **UserSleeps_YYYY-MM-DD.csv** has one row per sleep. Columns: `sleep_id, sleep_type (CLASSIC|STAGES), minutes_in_sleep_period, minutes_after_wake_up, minutes_to_fall_asleep, minutes_asleep, minutes_awake, minutes_longest_awakening, minutes_to_persistent_sleep, start_utc_offset, sleep_start, end_utc_offset, sleep_end, data_source, algorithm_version, sleep_created, sleep_last_updated`.
  - `sleep_start`/`sleep_end` are UTC (`Z`). `*_utc_offset` is the local offset (`+05:30`).
  - This export has **1 row**: a CLASSIC sleep with `data_source = MANUAL` (logged by hand, 345 min, 20/21 May).
- **UserSleepStages_YYYY-MM-DD.csv** has one row per stage segment. Columns: `sleep_id, sleep_stage_id, sleep_stage_type (AWAKE|LIGHT|DEEP|REM|ASLEEP), start_utc_offset, sleep_stage_start, end_utc_offset, sleep_stage_end, data_source, algorithm_version, sleep_stage_created, sleep_stage_last_updated`. It joins to UserSleeps on `sleep_id`. This export has 1 row, `ASLEEP` / `DERIVED`.
- **UserExercises_YYYY-MM-DD.csv** has 17 rows (12 Outdoor Walk, 2 Structured Workout, 2 Bike, 1 Stairclimber), 12 May to 6 Oct.
  - Key columns: `exercise_start, exercise_end, utc_offset, activity_name, log_type, tracker_total_calories, tracker_total_steps, tracker_total_distance_mm, tracker_avg_heart_rate, tracker_peak_heart_rate, …` (46 columns).
  - The importer counts these; it does not chart them.
- **CalibrationStatusForReadinessAndLoad.csv**: readiness and cardio load started calibrating on 6 Oct. That is why there is no readiness yet.
- Skipped: UserActivityProbabilities (17.4 MB), UserSensorCompressionToken (2.7 MB), Coach*, GoalSettingsHistory, UserConversations, WeeklyFitnessPlans, WorkoutSummariesAndRounds, AppContentHistory, User*Setting*/Profile/Premium/Location/Food/MBD. These are app state or personal, with no daily health value.

### 3.3 `Global Export Data/*.json` (legacy Fitbit export)

- Monthly files `<metric>-YYYY-MM-DD.json`, each a JSON array of `{"dateTime": "MM/DD/YY HH:MM:SS", "value": "…"}`.

| File family | Rows | Value | Timezone of `dateTime` (verified) |
|---|---:|---|---|
| steps | 27,775 | string count, per minute | **UTC**: 25,100 of 25,308 minutes match the UTC-stamped Steps CSV exactly |
| distance | 27,775 | string, **centimetres**, per minute | **UTC** (same stamps as steps) |
| calories | 219,997 | string kcal, per minute, includes BMR | **local (IST)**: 5,586 matches as local vs 56 as UTC, and the series ends at the export time in IST |
| sedentary / lightly / moderately / very_active_minutes | 180 each | daily minutes | local date. **Padded to 2 Nov** with placeholder days (sedentary 1440, others 0) |
| resting_heart_rate | 365 | `{date, value, error}` | local date. 7 May 2026 to 6 May 2027; every entry is `{date:null, value:0}` except one real day |
| demographic_vo2_max | 1 | `{demographicVO2Max, demographicVO2MaxError, filteredDemographicVO2Max, filteredDemographicVO2MaxError}` | local date |
| weight | 2 | `{logId, weight (lb), bmi, date, time, source}` | skipped; the grams CSV is used instead |
| height, badge, exercise, swim_lengths_data | few | | skipped |

- Global Export steps/distance are Fitbit's **reconciled** stream, merged across phone and band. On 6 Oct each CSV source (Health Connect, phone, Air) was within about 10% of the JSON total. Summing the three CSV sources nearly triples the real count.

### 3.4 Legacy folders

- **Active Zone Minutes (AZM)/Active Zone Minutes - YYYY-MM-DD.csv**: `date_time, heart_zone_id, total_minutes`. `date_time` is **local without a zone** (`9999-99-99T99:99`). It has 84 rows on 6 Oct and duplicates the Google-data family, so it is skipped.
- **Paired Devices/Trackers.csv**: `tracker_id, date_added, last_sync_date_time, …, device_type, …`. There are two trackers: **MobileTrack** (the phone, added 8 May) and **Fitbit Air** (added 6 Oct, last sync 18:23 IST).
- **Sleep Score, Stress Score, Temperature** (header only); **HRV, SpO2, Daily Readiness** (READMEs only). The legacy handlers for their documented layouts stay in place and will pick them up once data exists:
  - Daily HRV Summary `timestamp, rmssd, nremhr, entropy`
  - HRV Details `timestamp, rmssd, coverage, low_frequency, high_frequency`
  - Respiratory Rate Summary `timestamp, full_sleep_breathing_rate, …`
  - Daily SpO2 `timestamp, average_value, lower_bound, upper_bound`
  - Minute SpO2 `timestamp, value, …`
  - Daily Readiness `date, readiness_score_value, readiness_state, …`
  - Stress `DATE, STRESS_SCORE, …`
  - Sleep score `sleep_log_entry_id, timestamp, overall_score, …`

## 4. Data sources and devices

| `data source` value | What it is | Seen in |
|---|---|---|
| `MobileTrack` / `Google Health App` | the phone running the Fitbit / Google Health app (tracker "MobileTrack", added 8 May) | steps, distance, calories, active minutes, resting HR (daily) |
| `Fit Health Connect` | Android Health Connect mirror. It duplicates the phone (identical daily totals on 77 overlapping days) and is the **only** source for 8 Apr to 7 May, before the Fitbit account existed | steps, distance, calories, weight |
| `Google Fitbit Air` | the band (added 6 Oct, first sample 09:25 IST) | heart rate, AZM, body temperature, a few steps/distance minutes, live pace, cardio load |
| `MANUAL` / `DERIVED` | hand-logged sleep and its derived stage | UserSleeps / UserSleepStages |

## 5. Timezones (user is Asia/Calcutta, +05:30, no DST)

- All Google-data CSV `timestamp`s are UTC (`Z`) and are converted to IST before bucketing into days. A minute at 18:30Z or later belongs to the next IST day.
- Daily Google-data rows (`T00:00:00Z`) carry the local date as-is.
- Sleep uses the row's own `start_utc_offset` / `end_utc_offset`. The night is dated by its local **end** (wake) date.
- Global Export: steps/distance minute stamps are UTC; calories minute stamps are local; daily series are local dates.
- Legacy AZM `date_time` is local (it is skipped anyway).

## 6. Metric availability in this export

| Metric | Available? | Where | Dates |
|---|---|---|---|
| Steps | yes | Global Export JSON (reconciled) + Steps CSV | 8 Apr to 6 Oct 2026 (8 Apr to 7 May from Health Connect only) |
| Distance | yes | JSON (cm) + Distance CSV (m) | 9 Apr to 6 Oct |
| Calories | yes | JSON (local minutes) + Calories CSV | 8 May to 6 Oct |
| Active minutes (light/fairly/very, sedentary) | yes | daily JSON (+ Active Minutes CSV to 30 Sep) | 8 May to 6 Oct |
| Active Zone Minutes | yes, 1 day | AZM CSV (band) | 6 Oct |
| Heart rate (intraday) | yes, 1 day | Heart Rate CSV (band, about 5 s) | 6 Oct, 09:25 to 18:37 IST |
| Resting HR | yes, 1 day | Daily Resting Heart Rate CSV + JSON | 6 Oct |
| HRV | **no** | README only | |
| SpO2 | **no** | README only | |
| Breathing rate | **no** | README only | |
| Skin temperature | yes, 1 day (absolute wrist °C, not a nightly deviation) | Body Temperature CSV | 6 Oct |
| Sleep sessions + stages | 1 manual session, no stages | UserSleeps / UserSleepStages | night ending 21 May |
| Sleep score | **no** | header only | |
| Readiness | **no** (calibration started 6 Oct) | | |
| Stress | **no** | header only | |
| VO2 max | yes, 1 value | demographic_vo2_max JSON | 6 Oct |
| Weight | yes, 4 logs | Weight CSV (grams) | May to Oct |
| Exercises | 17 sessions (counted, not charted) | UserExercises | 12 May to 6 Oct |

## 7. Import rules (lib/googleHealth.js + lib/parser.js)

1. **Pre-filter.** Skipped files are never decompressed (`shouldRead`): personal folders, app/coach tables, the 17 MB activity-probability and sensor-token files, Calories In HR Zone, Live Pace, location, weather and nutrition. Unknown future families are still passed to the legacy handlers.
2. **Steps and distance.**
   - Primary: the Global Export reconciled minute stream, summed per IST day at priority 2.
   - Fallback (days not in the JSON, e.g. April): the Steps/Distance CSV with **one source per day, never a sum**. Health Connect rows are used only when no native Fitbit source exists that day. Among native sources (phone vs band) the most complete one is taken.
3. **Calories.** Global Export minutes in local time, then the Calories CSV with the same single-source rule.
4. **Active minutes.** Daily JSON (placeholder days dropped), then the Active Minutes CSV (light/moderate/very summed per day).
5. **Heart.** Band sources first (`Fitbit Air|Pixel Watch|…`) for heart rate, resting HR, AZM and skin temperature. Daily avg/min/max/sample count.
6. **Sleep.** UserSleeps joined to UserSleepStages on `sleep_id`. Stage minutes come from segment durations, and stages count only when DEEP/LIGHT/REM segments exist. The source is kept on the session (`MANUAL` here).
7. **Days.** Future days and placeholder days (no real signal) are dropped. The report lists devices, per-metric source counts and exercise count.

## 8. Doubts

- The only sleep is a **manual** log stored as 21:40Z to 03:25Z, i.e. 03:10 to 08:55 IST on 21 May. If it was typed in as 21:40 to 03:25 local time, the stored UTC is off by 5.5 h. It is imported as stored.
- Global Export JSON and the CSVs disagree slightly (about 1–2% of minutes) on steps; the JSON is treated as authoritative.
- The first resting HR value comes from a partial day of wear with no night, so it is likely higher than a true overnight resting HR.
