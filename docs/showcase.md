# Field Notes: Planning a Weekend Trail Run

A short guide to preparing for a 20 km trail race: training, gear, and race-day logistics. Use the **headings pane** on the left to jump between sections.

> **Goal:** finish strong, stay fueled, and enjoy the views, in that order.

## Training plan

Build volume gradually. Never raise weekly distance by more than about 10%.

| Week | Long run | Weekly total | Focus |
|:----:|---------:|-------------:|-------|
| 1 | 8 km | 22 km | Easy pace, find your rhythm |
| 2 | 10 km | 26 km | Add one hill session |
| 3 | 13 km | 30 km | Practice fueling on the move |
| 4 | 8 km | 18 km | Taper: rest those legs |

### Hill repeats

1. Warm up for 15 minutes on flat ground.
2. Run hard uphill for 60–90 seconds.
3. Walk or jog back down to recover.
4. Repeat 6–8 times, then cool down.

### Recovery

- Sleep 8 hours, especially after long runs
- Stretch calves, hamstrings, and hip flexors
- Take a full rest day every week

## Gear checklist

- [x] Trail shoes with a good grip
- [x] Hydration vest (1.5 L)
- [x] Wind jacket
- [ ] Headlamp for the early start
- [ ] Spare socks in the drop bag

## Nutrition

Aim for roughly **60 g of carbohydrate per hour** once you pass the one-hour mark. Test everything in training, *nothing new on race day*.

### Pace calculator

A quick script to estimate your finish time from a target pace:

```python
def finish_time(distance_km: float, pace_min_per_km: float) -> str:
    total = distance_km * pace_min_per_km
    hours, minutes = divmod(round(total), 60)
    return f"{hours}h {minutes:02d}m"

print(finish_time(20, 6.5))  # 2h 10m
```

## Race day

| Time | What |
|------|------|
| 5:30 | Wake up, light breakfast |
| 6:15 | Leave for the trailhead |
| 7:00 | Bib pickup & warm-up |
| 7:30 | **Start** |

### Course notes

The first 5 km climb about 400 m, so start slower than you think you should. The descent after the ridge is rocky; keep your eyes a few steps ahead. Aid stations are at km `7`, `13`, and `17`.

## After the finish

Refuel within 30 minutes, walk it off, and write down what worked while it's fresh. Then start planning the next one.

---

*Written in Markdown and read with Files.md.*
