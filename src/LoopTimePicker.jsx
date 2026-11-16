// LoopTimePicker - looping (infinite scroll) TimePicker.
// Wraps the AntD TimePicker and replaces its panel via panelRender
// with custom looping columns (LoopColumn).
//
// Idea: each column is rendered in three copies [left][original][right].
// When the user scrolls to the edge of one copy, scrollTop is silently
// shifted by the height of one copy - visually the scroll is infinite.
// 
// NOTE:
// AntD's own onOk/onChange are used only as a transport for manual input, 
// thus AntD's own onChange is used only for clearing (allowClear) and
// for manual input in the input field (editable).

import React, { useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle, useContext } from "react";
import { TimePicker, Button, ConfigProvider, theme } from "antd";
import dayjs from "dayjs";

// Warning on an incorrect locale setup.
const localeWarning = { shown: false };

// Pads a number with a leading zero up to two digits.
const pad2 = (n) => String(n).padStart(2, "0");

// Height of one column row.
const ITEM_HEIGHT = 28;

// How many rows are visible in the column at once.
const VISIBLE_ITEMS = 8;

// How many copies of the list to render. 3 = [left][original][right], 
// the minimum sufficient for a seamless loop in both directions. 
// Fewer than 3 copies cannot give a seamless loop in both directions. 
// The loop assumes items.length >= VISIBLE_ITEMS; shorter columns are not looped (and not scrollable)
const COPIES = 3;

// After how many ms of scroll stop the position is considered "settled" and the selection is accepted (for changeOnScroll and for snap-to-center).
// 180 ms - empirical: less - snaps during inertia, more - feels laggy.
const SCROLL_SETTLE_DELAY = 180;

// Keys that scroll a focused column. Tab is intentionally not included:
// it only moves focus and must not be treated as a scroll.
const SCROLL_KEYS = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];

/**
 * Returns localized AM/PM labels for the given locale.
 * Uses Intl (CLDR) rather than dayjs: some dayjs locales (e.g. Russian) return
 * a different label depending on the hour (night/morning/day/evening), while
 * the AM/PM column needs one fixed label per half of the day.
 * Note:
 * If Intl throws (old browsers, bad localeTag) - silently fall back to ["AM", "PM"].
 */
const getAmPmLabels = (localeTag) => {
  try {
    // Formatter with hour12: true and timeZone: "UTC" - to get day/night independently of the user's timezone. Format 9 am and 3 pm to reliably obtain both dayPeriods.
    const f = new Intl.DateTimeFormat(localeTag, { hour: "numeric", hour12: true, timeZone: "UTC" });
    // Extracts the dayPeriod from formatToParts for a specific hour.
    const get = (h) =>
      f.formatToParts(new Date(Date.UTC(2000, 0, 1, h))).find((p) => p.type === "dayPeriod")?.value;
    // h=9 - definitely AM, h=15 - definitely PM.
    const am = get(9), pm = get(15);
    // Guard for the case when the locale doesn't distinguish AM/PM (e.g., a 24-hour format in some locales returns the same dayPeriod).
    return am && pm && am !== pm ? [am, pm] : ["AM", "PM"];
  } catch {
    return ["AM", "PM"];
  }
};

/**
 * Parses the format (dayjs string) and figures out which columns to show.
 * `use12Prop` - explicit override via the use12Hours prop; if not set,
 * the format itself determines the 12-hour mode by the presence of "a"/"A".
 *
 * `bare` - format without escaped literals like [text], so that
 * the letters H/h/m/s/a inside [..] are not treated as tokens 
 * ("[at] HH:mm" must not turn on 12-hour mode because of the 'a' in "at".).
 */
const parseFormat = (format, use12Prop) => {
  // Default format: 12h if 12h was explicitly requested, otherwise 24h with seconds.
  const f = format || (use12Prop ? "hh:mm:ss a" : "HH:mm:ss");
  // Remove [..] literals
  const bare = f.replace(/\[[^\]]*\]/g, "");
  return {
    format: f,
    showHour: /H|h/.test(bare),                                 // H - 24h, h - 12h
    showMinute: /m/.test(bare),                                 // m - minutes (ignoring escaping)
    showSecond: /s/.test(bare),                                 // s - seconds
    use12: use12Prop != null ? use12Prop : /a|A/.test(bare),    // explicit prop > auto-detection
  };
};

/**
 * Builds the step array [0, step, 2*step, ...] up to 60 (exclusive).
 * step<=0 is protected against division/infinite loop (normalized to 1).
 * Used for minutes and seconds.
 */
const buildMinuteSecondOptions = (step) => {
  const s = step > 0 ? step : 1;
  return Array.from({ length: Math.ceil(60 / s) }, (_, i) => i * s);
};

/**
 * Builds the hour array taking into account the step and 12/24 mode.
 * In 12h mode hour 0 is shown as 12: 12, 1, 2, ..., 11 
 * (with step 2: 12, 2, 4, ...).
 */
const buildHourOptions = (step, use12) => {
  const s = step > 0 ? step : 1;
  const count = use12 ? 12 : 24;
  return Array.from({ length: Math.ceil(count / s) }, (_, i) => (use12 && i * s === 0 ? 12 : i * s));
};

/**
 * Converts value to a dayjs object.
 * Already a dayjs - return as is (important for utc/tz modes).
 * Date - wrap via dayjs() (local parsing).
 * string - first try to parse strictly by the format, then fall back to dayjs(value).
 * null/"" - return null.
 */
const toDayjs = (value, format) => {
  if (value == null || value === "") return null;
  if (dayjs.isDayjs(value)) return value;
  if (value instanceof Date) return dayjs(value);
  const parsed = dayjs(value, format, true);
  if (parsed.isValid()) return parsed;
  const fallback = dayjs(value);
  return fallback.isValid() ? fallback : null;
};

// ---------- LoopColumn ----------
// A single column with infinite scroll.
// Props:
//   items - [{ value, label, disabled }] - elements in one cycle (no copies)
//   value - currently selected value (a primitive, compared with items[i].value)
//   onChange - callback on selection change (click or, if changeOnScroll, scroll)
//   changeOnScroll - if true, selection changes on scroll (debounced)
//   itemHeight - row height
const LoopColumn = ({
  items,
  value,
  onChange,
  changeOnScroll = false,
  itemHeight = ITEM_HEIGHT,
}) => {
  // Reference to the <ul> - needed for programmatic scrolling and reading scrollTop.
  const containerRef = useRef(null);
  // Debounce timer for changeOnScroll / snap-to-center.
  const settleTimerRef = useRef(null);
  // Last value set via scroll/click. Needed so that the [value] sync effect
  // does not reset a programmatically scrolled position
  // at the moment the parent gives us the new value.
  const lastScrolledValueRef = useRef(null);

  // Looping only makes sense if there are enough items to fill the
  // visible area. Otherwise the column is short - block scrolling (CSS class).
  const looped = items.length >= VISIBLE_ITEMS;
  // Height of the visible area.
  const containerHeight = VISIBLE_ITEMS * itemHeight;
  // Height of one copy of the list.
  const copyHeight = looped ? items.length * itemHeight : 0;
  // Offset from the top of the visible area to the top of the center row.
  // Used both for scrolling and for computing the "current index by center".
  const centerOffset = Math.floor((containerHeight - itemHeight) / 2);

  // onChange in a ref - to avoid recreating handleScroll/handleClick
  // on every render when the parent swaps the callback.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // Same for value - needed inside handleScroll without recreating the effect.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Flag "the user has actually started scrolling". Separates user scroll
  // from programmatic scroll (from the value sync effect or from snapping).
  // Programmatic scroll must not be counted as a selection in changeOnScroll,
  // otherwise we get a loop: value -> snap -> changeOnScroll -> onChange(value) -> value...
  const userScrollRef = useRef(false);
  const markUser = useCallback(() => { userScrollRef.current = true; }, []);
  // onPointerDown - only if the click was exactly on the empty area of <ul>
  // (not on <li>, so a click on a row is not treated as "scroll").
  const onPointerDown = useCallback((e) => {
    if (e.target === e.currentTarget) markUser();
  }, [markUser]);
  // Keyboard scrolling of a focused column counts as user scroll too,
  // otherwise changeOnScroll and our snap-to-center would ignore it.
  const onKeyDown = useCallback((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (SCROLL_KEYS.includes(e.key)) markUser();
  }, [markUser]);

  // Index of the selected element in the original (not multiplied) list.
  // If value is not in items - 0 (safe default so that scrollTop stays valid).
  const selectedIndex = useMemo(() => {
    const idx = items.findIndex((it) => it.value === value);
    return idx >= 0 ? idx : 0;
  }, [items, value]);

  // Target scrollTop at which the element with index idx is
  // exactly in the center of the visible area. Always in the middle copy
  // (copyHeight + ...) so there is a buffer for scrolling in both directions.
  const centerScrollTop = useCallback(
    (idx) => (looped ? Math.max(0, copyHeight + idx * itemHeight - centerOffset) : 0),
    [looped, copyHeight, itemHeight, centerOffset]
  );

  // Sync scrollTop when value changes externally (e.g., the parent
  // passed a new value, or we programmatically reset value).
  // Skipped if the value came from our own scroll/click
  // (lastScrolledValueRef) - otherwise we fight our own snap.
  useEffect(() => {
    const ul = containerRef.current;
    if (!ul) return;
    if (value === lastScrolledValueRef.current) {
      lastScrolledValueRef.current = null;
      return;
    }
    const idx = selectedIndex;
    ul.scrollTop = centerScrollTop(idx);
    lastScrolledValueRef.current = null;
  }, [value, selectedIndex, centerScrollTop]);

  // Scroll handler:
  //  1) Seamless transition between copies (teleport scrollTop).
  //  2) Debounce -> snap to center + optional onChange.
  const handleScroll = useCallback(
    (e) => {
      const ul = e.target;
      if (!looped) return;

      // Seamless loop: if the user has scrolled into the first "half" of the first
      // copy or into the second "half" of the last one - shift scrollTop by one
      // copy. The threshold is itemHeight, not 0/3*copyHeight, to avoid a visible
      // jump on the boundary.
      if (ul.scrollTop < itemHeight) {
        ul.scrollTop += copyHeight;
      } else if (ul.scrollTop > 2 * copyHeight - itemHeight) {
        ul.scrollTop -= copyHeight;
      }

      // From here on - user scroll only. Ignore programmatic
      // events, otherwise changeOnScroll would fire on our own snap.
      if (!userScrollRef.current) return;

      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = setTimeout(() => {
        userScrollRef.current = false;
        // Guard against a column that was already unmounted while the timer
        // was ticking (popup closed, component removed) - otherwise we read
        // from dead DOM.
        if (!ul.isConnected || !ul.clientHeight) return;

        // Index of the element currently in the center of the visible area.
        const relative = ul.scrollTop + centerOffset;
        const rawIndex = Math.round(relative / itemHeight);
        // Modulo with a negative guard (although scrollTop >= 0, just in case).
        const itemIndex = ((rawIndex % items.length) + items.length) % items.length;
        const target = items[itemIndex];

        // changeOnScroll: accept the selection if the value changed and is available.
        if (changeOnScroll && target && !target.disabled && target.value !== valueRef.current) {
          lastScrolledValueRef.current = target.value;
          onChangeRef.current && onChangeRef.current(target.value);
        }

        // Snap to the center of the nearest element. Always, so the wheel
        // "clicks" to an integer value after inertia.
        const nearestTop = rawIndex * itemHeight - centerOffset;
        if (ul.scrollTo) {
          ul.scrollTo({ top: Math.max(0, nearestTop), behavior: "smooth" });
        } else {
          ul.scrollTop = Math.max(0, nearestTop);
        }
      }, SCROLL_SETTLE_DELAY);
    },
    [changeOnScroll, looped, copyHeight, itemHeight, centerOffset, items]
  );

  // Cleanup on unmount - kill the pending debounce so we don't fire
  // onChange on a removed component.
  useEffect(() => () => {
    clearTimeout(settleTimerRef.current);
  }, []);

  // Click on a specific row (in any of the three copies).
  // rawIndex - the index of the clicked cell among all (3 * items.length) rows.
  const handleClick = useCallback(
    (it, rawIndex) => {
      if (it.disabled) return;
      // A click is definitely a user action, but not a scroll.
      // Reset so the debounced snap doesn't treat it as a scroll-selection.
      userScrollRef.current = false;
      clearTimeout(settleTimerRef.current);
      lastScrolledValueRef.current = it.value;
      // Report the selected value outward.
      onChange && onChange(it.value);
      // Center exactly the clicked clone (not the original) to avoid
      // a visual jump to the other end of the list.
      const ul = containerRef.current;
      if (looped && ul && rawIndex != null) {
        const targetTop = Math.max(0, rawIndex * itemHeight - centerOffset);
        if (ul.scrollTo) {
          ul.scrollTo({ top: targetTop, behavior: "smooth" });
        } else {
          ul.scrollTop = targetTop;
        }
      }
    },
    [onChange, itemHeight, looped, centerOffset]
  );

  // Number of copies: 3 if looping, 1 if the column is short.
  const copies = looped ? COPIES : 1;
  // Flatten the 2D (copies x items) into a flat <li> array.
  // The key `${copyIndex}-${it.value}` is stable between renders, which lets
  // React avoid repainting the DOM when items are recreated (new array, same values).
  const renderedItems = Array.from({ length: copies * items.length }, (_, n) => {
    const it = items[n % items.length];
    return (
      <li
        key={`${Math.floor(n / items.length)}-${it.value}`}
        className={`ant-picker-time-panel-cell ${value === it.value ? "ant-picker-time-panel-cell-selected" : ""} ${
          it.disabled ? "ant-picker-time-panel-cell-disabled" : ""
        }`}
        style={{ height: itemHeight }}
        onClick={() => handleClick(it, n)}
        data-value={it.value}
      >
        <div className="ant-picker-time-panel-cell-inner">{it.label}</div>
      </li>
    );
  });

  // Empty columns are not rendered at all (nothing to show).
  if (!items || items.length === 0) return null;

  return (
    <ul
      ref={containerRef}
      // loop-column-static - CSS class that forcibly disables overflow-y and
      // scroll-snap for short columns (AM/PM): there is nothing to loop there,
      // and "snapping to center" only gets in the way.
      className={`ant-picker-time-panel-column${looped ? "" : " loop-column-static"}`}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
      // Any finger/wheel movement or specific key presses are marked as "user scroll".
      // This lets us distinguish programmatic snap from a real action.
      onTouchMove={markUser}
      onWheel={markUser}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      {renderedItems}
    </ul>
  );
};

// ---------- LoopTimePicker ----------
// editable: the format is a string, AM/PM in the input comes from the dayjs locale (whereas in the column - from Intl);
// in other locales you cannot type "PM".
// now: () => dayjs - a "current moment" factory for dayjs.utc/dayjs.tz mode, e.g. now={() => dayjs.utc()}.
// The value in utc/tz mode must be passed as a dayjs object: strings and Dates are treated as local time.
//
// NOTE: when the panel closes, rc-picker still emits onChange with the value it was opened with
// (its own draft). needConfirm={true} does not prevent this; the guards inside onChange do
// (null/undefined checks and openedTimeRef). onOk is intentionally not passed to <TimePicker>:
// in our tests (antd 5.27.6) it was never called, neither on Enter nor on close; the effect of
// passing it was not verified. Re-check this when upgrading antd.
const LoopTimePicker = React.forwardRef((props, ref) => {
  const {
    value: valueProp,
    defaultValue,
    format: formatProp,
    onChange,
    onOk,
    disabled = false,
    open: openProp,
    onOpenChange,
    use12Hours: use12Prop,
    showNow = true,
    needConfirm,
    changeOnScroll = false,
    hourStep = 1,
    minuteStep = 1,
    secondStep = 1,
    disabledTime,
    renderExtraFooter,
    popupClassName,
    editable = false,
    now: nowProp,
    ...rest
  } = props;

  // Parse the format: what to show, 12h or 24h.
  const { format, showHour, showMinute, showSecond, use12 } = parseFormat(formatProp, use12Prop);
  // effectiveUse12: the explicit use12Hours prop takes precedence over auto-detection from the format.
  const effectiveUse12 = use12Prop != null ? use12Prop : use12;

  // nowProp in a ref - to keep getNow stable while reading the freshest value
  // (the parent may pass a new factory on each render).
  const nowRef = useRef(nowProp);
  nowRef.current = nowProp;
  // Returns the "current moment" in the required mode (local/utc/tz).
  // Stable by identity - safe to include in deps.
  const getNow = useCallback(() => (nowRef.current ? nowRef.current() : dayjs()), []);

  // committedValue - what is actually committed (in the input and in the form).
  // pendingValue - the "draft": changes on click/scroll in the columns,
  // committed to committedValue when needConfirm={false} or on OK.
  // If valueProp is passed - committedValue is synced with it by the effect below.
  const [committedValue, setCommittedValue] = useState(() => toDayjs(valueProp != null ? valueProp : defaultValue, format));
  const [pendingValue, setPendingValue] = useState(() => toDayjs(valueProp != null ? valueProp : defaultValue, format));

  // Controlled/uncontrolled panel opening.
  const controlledOpen = openProp !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ? openProp : internalOpen;

  // pickerKey - a trick: when the panel closes, if committedValue changed
  // (the user selected something new), we recreate the inner TimePicker.
  // This resets AntD's internal draft, otherwise it overwrites input.value
  // with its stale value on the next render.
  const [pickerKey, setPickerKey] = useState(0);
  const committedMs = committedValue ? committedValue.valueOf() : null;
  const syncedMsRef = useRef(committedMs);

  useEffect(() => {
    if (!isOpen && syncedMsRef.current !== committedMs) {
      syncedMsRef.current = committedMs;
      setPickerKey((k) => k + 1);
    }
  }, [committedMs, isOpen]);

  // committedRef - the current committedValue for callbacks (stability without deps).
  const committedRef = useRef(committedValue);
  committedRef.current = committedValue;
  // openedTimeRef - the value at the moment the panel was opened. Used in editable
  // mode to filter out the stale onChange event from rc-picker on close:
  // rc-picker emits onChange(value_at_open_time), which is not user input.
  const openedTimeRef = useRef(null);

  // On every open, reset pendingValue to committedValue -
  // the "draft" must start from the current committed value.
  // Also remember openedTime for the guard in onChange.
  useEffect(() => {
    if (isOpen) {
      setPendingValue(committedRef.current);
      openedTimeRef.current = committedRef.current ? committedRef.current.format("HH:mm:ss") : null;
    }
  }, [isOpen]);

  /**
   * Checks whether the moment d falls into disabled time.
   * Supports disabledTime as both an object and a function (AntD style).
   * Used for:
   *   - disabled on the "Now" and OK buttons
   *   - guard in their onClick (race between render and click)
   *   - guard in TimePicker.onChange (manual input)
   *
   * IMPORTANT: called many times per render (isDisabledValue for "Now", for OK,
   * plus inside disabledConfig and hourOptions). If disabledTime is heavy
   * (Intl/tz/requests) - cache it.
   */
  const isDisabledValue = useCallback((d) => {
    const cfg = typeof disabledTime === "function" ? disabledTime(d) || {} : disabledTime || {};
    // Helper: extract an array (or the result of a call) from a disabledTime field.
    const list = (f, ...a) => (typeof f === "function" ? f(...a) : f || []);
    return (
      list(cfg.disabledHours).includes(d.hour()) ||
      list(cfg.disabledMinutes, d.hour()).includes(d.minute()) ||
      list(cfg.disabledSeconds, d.hour(), d.minute()).includes(d.second())
    );
  }, [disabledTime]);

  // pickerRef - for forwardRef outward. Also used internally
  // to test "click inside/outside" (pickerRef.current.nativeElement).
  const pickerRef = useRef(null);
  useImperativeHandle(ref, () => pickerRef.current);

  /**
   * Open/close control. For controlled mode (openProp set) - just forward
   * outward; for uncontrolled - update internalOpen.
   * disabled blocks both opening and closing.
   */
  const setOpenState = useCallback(
    (next) => {
      if (disabled) return;
      if (next) {
        if (!controlledOpen) setInternalOpen(true);
        onOpenChange && onOpenChange(true);
      } else {
        setInternalOpen(false);
        onOpenChange && onOpenChange(false);
      }
    },
    [controlledOpen, disabled, onOpenChange]
  );

  // Sync committedValue/pendingValue with the external valueProp.
  // React only to real changes (by ms + utcOffset, to catch tz/utc
  // transitions), otherwise we get a loop from our own onChange.
  const isControlled = "value" in props;
  const parsedProp = isControlled ? toDayjs(valueProp, format) : null;
  const validProp = parsedProp && parsedProp.isValid() ? parsedProp : null;
  const propMs = validProp ? validProp.valueOf() : null;
  const propOffset = validProp ? validProp.utcOffset() : null;
  // validProp in a ref - so the effect depends on primitives (propMs, propOffset),
  // not on the identity of the dayjs object (the parent may create a new one on every render).
  const validPropRef = useRef(validProp);
  validPropRef.current = validProp;

  useEffect(() => {
    if (!isControlled) return;
    const next = validPropRef.current;
    setCommittedValue(next);
    setPendingValue(next);
  }, [propMs, propOffset, isControlled]);

  /**
   * Commits the value: writes to committedValue (for display) and
   * calls the external onChange. Used on click/scroll
   * with needConfirm={false}, and on OK.
   */
  const commitValue = useCallback(
    (nextDayjs) => {
      setCommittedValue(nextDayjs);
      onChange && onChange(nextDayjs, nextDayjs ? nextDayjs.format(format) : "");
    },
    [onChange, format]
  );

  /**
   * Normalizes the value after a field change so that it stays valid
   * under disabledTime.
   *
   * Example: value is 21:53, disabledMinutes(21) = [1..59].
   * User clicks "21" in the hour column - we get 21:53, but this is
   * disabled time. The function sees the minute is disabled and replaces it
   * with the first available one (0) -> 21:00.
   *
   * Similarly for seconds when the minute or hour changes.
   *
   * Does NOT normalize hours (e.g., when switching AM->PM, if the new hour
   * is blocked by disabledHours). In that case pendingValue stays invalid,
   * but the OK button is disabled and, with needConfirm={false}, updateField
   * does not commit the invalid value (see the guard in updateField).
   */
  const normalizeAfterChange = useCallback((d, changedField) => {
    const cfg = typeof disabledTime === "function" ? disabledTime(d) || {} : disabledTime || {};
    const list = (f, ...a) => (typeof f === "function" ? f(...a) : f || []);
    // First available value (respecting the step), or undefined if all are disabled.
    const firstAvailable = (disabledArr, step) =>
      buildMinuteSecondOptions(step).find((v) => !disabledArr.includes(v));

    // Fix minutes only if the hour or AM/PM changed.
    const fixMinute = (x) => {
      if (changedField !== "hour" && changedField !== "ampm") return x;
      const dm = list(cfg.disabledMinutes, x.hour());
      if (!dm.includes(x.minute())) return x;
      const m = firstAvailable(dm, minuteStep);
      return m === undefined ? x : x.minute(m);
    };

    // Fix seconds on any change except a change of the second itself.
    const fixSecond = (x) => {
      if (changedField === "second") return x;
      const ds = list(cfg.disabledSeconds, x.hour(), x.minute());
      if (!ds.includes(x.second())) return x;
      const s = firstAvailable(ds, secondStep);
      return s === undefined ? x : x.second(s);
    };

    return fixSecond(fixMinute(d));
  }, [disabledTime, minuteStep, secondStep]);

  /**
   * Change one field (hour/minute/second/ampm).
   * Updates pendingValue; with needConfirm={false} commits immediately.
   *
   * Applies normalizeAfterChange - see above.
   */
  const updateField = useCallback(
    (field, v) => {
      // Base: pendingValue if present; else committedValue; else - today at 00:00.
      const cur = pendingValue || committedValue;
      const base = cur ? cur.clone() : getNow().startOf("day");
      // New value with one field changed.
      const nextRaw =
        field === "hour"
          ? effectiveUse12
            // In 12h: keep the AM/PM of the current value, change only the 1..12 hours.
            ? base.hour((v % 12) + (base.hour() >= 12 ? 12 : 0))
            : base.hour(v)
          : field === "minute"
          ? base.minute(v)
          : field === "second"
          ? base.second(v)
          : field === "ampm"
          // In 12h: same hour, but with the required AM/PM.
          ? base.hour((base.hour() % 12) + (v === "pm" ? 12 : 0))
          : base;
      // Normalize minutes/seconds if they became disabled.
      const next = normalizeAfterChange(nextRaw, field);

      setPendingValue(next);
      // needConfirm={false} - commit immediately; otherwise wait for OK.
      if (needConfirm === false && !isDisabledValue(next)) commitValue(next);
    },
    [pendingValue, committedValue, effectiveUse12, needConfirm, commitValue, normalizeAfterChange, getNow]
  );

  // pv - the "currently visible" value: pendingValue for the open panel,
  // committedValue as the fallback.
  const pv = pendingValue || committedValue;

  // disabledTime config computed for the current pv. disabledHours / disabledMinutes / disabledSeconds for the columns are then derived from it.
  // useMemo so we don't run heavy disabledTime on every render.
  // NOTE: disabledConfig depends on pv as a whole - when the minute changes,
  // hourOptions is also recreated. If profiling shows lag - split it into "by hour"
  // and "by minute/second".
  const disabledConfig = useMemo(() => {
    if (!disabledTime) return {};
    if (typeof disabledTime === "function") {
      try {
        return disabledTime(pv || getNow()) || {};
      } catch {
        return {};
      }
    }
    return disabledTime || {};
  }, [disabledTime, pv, getNow]);

  // List of disabled hours (hours only, without minutes/seconds).
  const disabledHours = useMemo(() => {
    const dh = disabledConfig.disabledHours;
    return dh ? (typeof dh === "function" ? dh() : dh) : [];
  }, [disabledConfig]);

  // Is pv PM (for building hours in 12h mode).
  const isPm = pv ? pv.hour() >= 12 : false;

  // Hour column items.
  // Cross-check: if for an hour all available minutes (respecting the step) are
  // disabled - the hour is effectively disabled; mark it. This covers the edge
  // where normalizeAfterChange cannot fix an invalid value (no free minute left).
  const hourOptions = useMemo(
    () => {
      const dmFn = disabledConfig.disabledMinutes;
      const minuteValues = buildMinuteSecondOptions(minuteStep);
      return buildHourOptions(hourStep, effectiveUse12).map((h) => {
        // h24 - the hour in 24h format for the disabledHours check.
        const h24 = effectiveUse12 ? (h % 12) + (isPm ? 12 : 0) : h;
        const baseDisabled = disabledHours.includes(h24);
        // If the hour is already disabled by disabledHours - don't waste time on minute checks.
        const dmList = baseDisabled || !dmFn ? [] : typeof dmFn === "function" ? dmFn(h24) : dmFn;
        // Are all minutes (0, step, 2*step...) disabled?
        const allMinutesDisabled = !baseDisabled && minuteValues.every((m) => dmList.includes(m));
        return { value: h, label: pad2(h), disabled: baseDisabled || allMinutesDisabled };
      });
    },
    [hourStep, minuteStep, effectiveUse12, disabledHours, disabledConfig, isPm]
  );

  // Cache pvHour/pvMinute so the useMemo deps below are
  // primitives (not the pv object - reference stability).
  const pvHour = pv ? pv.hour() : null;
  const pvMinute = pv ? pv.minute() : null;

  // Set of disabled minutes for the current hour.
  const disabledMinuteSet = useMemo(() => {
    const dm = disabledConfig.disabledMinutes;
    if (pvHour == null || !dm) return new Set();
    return new Set(typeof dm === "function" ? dm(pvHour) : dm);
  }, [disabledConfig, pvHour]);

  // Set of disabled seconds for the current hour and minute.
  const disabledSecondSet = useMemo(() => {
    const ds = disabledConfig.disabledSeconds;
    if (pvHour == null || !ds) return new Set();
    return new Set(typeof ds === "function" ? ds(pvHour, pvMinute) : ds);
  }, [disabledConfig, pvHour, pvMinute]);

  // Minute column items.
  const minuteItems = useMemo(
    () => buildMinuteSecondOptions(minuteStep).map((m) => ({ value: m, label: pad2(m), disabled: disabledMinuteSet.has(m) })),
    [minuteStep, disabledMinuteSet]
  );
  // Second column items.
  const secondItems = useMemo(
    () => buildMinuteSecondOptions(secondStep).map((s) => ({ value: s, label: pad2(s), disabled: disabledSecondSet.has(s) })),
    [secondStep, disabledSecondSet]
  );

  // AntD locale for the "Now"/"OK" texts and for the AM/PM labels.
  const context = useContext(ConfigProvider.ConfigContext);
  const antdLocale = context?.locale;
  // Token for applying the AntD's theme on non-standard components.
  const { token } = theme.useToken();

  // Checking if the locale is passed correctly for the environment,
  // and warning the developer if that is not the case.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && antdLocale?.default && !localeWarning.shown) {
      localeWarning.shown = true;
      console.warn(
        "[LoopTimePicker] The AntD locale is wrapped in a 'default' object. " +
        "This usually happens in Vite when importing CJS locales. " +
        "Please use 'antd/es/locale/<lang>' or unwrap it: 'const locale = <lang>.default || <lang>'. " +
        "Your placeholders and button texts might be in English until this is fixed."
      );
    }
  }, [antdLocale]);

  const localeTag = antdLocale?.locale || (committedValue || getNow()).locale() || dayjs.locale() || "en";
  const nowText = antdLocale?.DatePicker?.lang?.now ?? "Now";
  const okText = antdLocale?.DatePicker?.lang?.ok ?? "OK";
  const [amLabel, pmLabel] = useMemo(() => getAmPmLabels(localeTag), [localeTag]);

  // AM/PM column items. Always available.
  const ampmItems = useMemo(
    () => [
      { value: "am", label: amLabel, disabled: false },
      { value: "pm", label: pmLabel, disabled: false },
    ],
    [amLabel, pmLabel]
  );

  // Current values displayed in the columns (for the selected highlight).
  // In 12h mode, hours 0/12 are shown as 12, the rest as is.
  const rawHour = pv ? pv.hour() : (effectiveUse12 ? 12 : 0);
  const currentHour = effectiveUse12 ? (rawHour % 12 === 0 ? 12 : rawHour % 12) : rawHour;
  const currentMinute = pv ? pv.minute() : 0;
  const currentSecond = pv ? pv.second() : 0;
  const currentAmPm = pv ? (pv.hour() >= 12 ? "pm" : "am") : "am";

  /**
   * Formats value for the input, substituting localized AM/PM (amLabel/pmLabel)
   * instead of the raw "am"/"pm" from the dayjs format.
   *
   * Problem: dayjs cannot localize AM/PM markers (it does not override
   * day/night in locales). So we take localized labels via Intl (see
   * getAmPmLabels) and substitute them as [label] literals in the format.
   *
   * Works only in a readOnly input (editable=false) - cannot be used in editable
   * mode because the AntD parser will not understand the literal.
   */
  const displayFormat = useCallback((value) => {
    if (!value) return "";
    // No AM/PM in the format - normal formatting.
    if (!/[aA]/.test(format)) return value.format(format);
    const label = value.hour() < 12 ? amLabel : pmLabel;
    // Replace single a/A with [label] literals; keep existing [..] as is.
    const fmt = format.replace(/\[[^\]]*\]|[aA]/g, (m) => (m.length === 1 ? `[${label}]` : m));
    return value.format(fmt);
  }, [format, amLabel, pmLabel]);

  /**
   * Renders the custom panel: columns + footer (Now / OK).
   * Fully replaces the standard AntD panel - rc-picker does not know about
   * the selection in the columns and cannot auto-commit; our updateField does it all.
   */
  const panelRender = useCallback(
    () => {
      return (
        <div className="ant-picker-time-panel">
          <div className="ant-picker-content" style={{ display: "flex" }}>
            {showHour && (
              <LoopColumn
                items={hourOptions}
                value={currentHour}
                onChange={(v) => updateField("hour", v)}
                changeOnScroll={changeOnScroll}
              />
            )}
            {showMinute && (
              <LoopColumn
                items={minuteItems}
                value={currentMinute}
                onChange={(v) => updateField("minute", v)}
                changeOnScroll={changeOnScroll}
              />
            )}
            {showSecond && (
              <LoopColumn
                items={secondItems}
                value={currentSecond}
                onChange={(v) => updateField("second", v)}
                changeOnScroll={changeOnScroll}
              />
            )}
            {effectiveUse12 && (
              <LoopColumn
                items={ampmItems}
                value={currentAmPm}
                onChange={(v) => updateField("ampm", v)}
                changeOnScroll={changeOnScroll}
              />
            )}
          </div>
          {(showNow || needConfirm !== false || renderExtraFooter) && (
            <div className="ant-picker-footer">
              {renderExtraFooter && <div className="ant-picker-footer-extra">{renderExtraFooter()}</div>}
              {(showNow || needConfirm !== false) && (
                <ul className="ant-picker-ranges">
                  {showNow && (
                    <li className="ant-picker-now">
                      <button
                        type="button"
                        className="ant-picker-now-btn"
                        style={{
                          "--ltp-link": token.colorLink,
                          "--ltp-link-hover": token.colorLinkHover,
                          "--ltp-disabled": token.colorTextDisabled,
                        }}
                        // disabled based on the current moment: if "now" falls
                        // into disabledTime - the button is greyed out.
                        // IMPORTANT: dayjs/getNow is evaluated on every render - on the boundary
                        // of working hours the button will only become greyed on the next
                        // render (not instantly). Acceptable for production.
                        disabled={isDisabledValue(getNow())}
                        onClick={() => {
                          const now = getNow();
                          // Race guard: between the render and the "now" click
                          // we might have crossed the disabledTime boundary.
                          if (isDisabledValue(now)) return;
                          setPendingValue(now);
                          // needConfirm={false} - commit "now" immediately.
                          if (needConfirm === false) {
                            commitValue(now);
                          }
                        }}
                      >
                        {nowText}
                      </button>
                    </li>
                  )}
                  {needConfirm !== false && (
                    <li className="ant-picker-ok">
                      <Button
                        size="small"
                        type="primary"
                        disabled={!!(pendingValue && isDisabledValue(pendingValue))}
                        onClick={() => {
                          const v = pendingValue || committedValue;
                          // Race guard, same as for "Now".
                          if (v && isDisabledValue(v)) return;
                          if (onOk) onOk(v);
                          commitValue(v);
                          setOpenState(false);
                        }}
                      >
                        {okText}
                      </Button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </div>
      );
    },
    [
      showHour,
      showMinute,
      showSecond,
      effectiveUse12,
      hourOptions,
      minuteItems,
      secondItems,
      ampmItems,
      currentHour,
      currentMinute,
      currentSecond,
      currentAmPm,
      updateField,
      needConfirm,
      changeOnScroll,
      showNow,
      renderExtraFooter,
      commitValue,
      setOpenState,
      onOk,
      pendingValue,
      committedValue,
      nowText,
      okText,
      isDisabledValue,
      getNow,
      token.colorLink,
      token.colorLinkHover,
      token.colorTextDisabled,
    ]
  );

  // Close when a pointer press or keyboard focus lands outside the input and the popup.
  // focusin covers Tab: rc-picker's own close-on-blur is ignored (see onOpenChange below).
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      const target = e.target;
      const root = pickerRef.current && pickerRef.current.nativeElement;
      if (root && root.contains(target)) return;
      if (target.closest && target.closest(".ant-picker-dropdown")) return;
      setOpenState(false);
    };
    document.addEventListener("pointerdown", handler, true);
    document.addEventListener("focusin", handler, true);
    return () => {
      document.removeEventListener("pointerdown", handler, true);
      document.removeEventListener("focusin", handler, true);
    };
  }, [isOpen, setOpenState]);

  // Close on Escape. stopPropagation - to avoid closing the parent modal.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpenState(false);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [isOpen, setOpenState]);

  return (
    <TimePicker
      // key - a forced re-instantiation. On close, if committedValue changed,
      // we want to reset AntD's internal draft (otherwise it overwrites
      // input.value). See pickerKey above.
      key={pickerKey}
      ref={pickerRef}
      {...rest}
      value={committedValue}
      /**
       * AntD onChange is used only for:
       *   - clearing (v === null) via allowClear
       *   - manual typing into the input (editable=true)
       * In the normal mode (readOnly) the panel is replaced with panelRender,
       * so onChange from AntD must not fire (see the note above the component
       * for details on rc-picker's stale onChange behavior).
       */
      onChange={(v) => {
        // Explicit clear (the cross) arrives as null.
        if (v === null) {
          setCommittedValue(null);
          setPendingValue(null);
          onChange && onChange(null, "");
          return;
        }
        // rc-picker emits undefined on close after clear; this is not a clear, ignore it.
        if (v === undefined) return;
        // Below - only for editable: manual user input.
        if (!editable) return;
        // rc-picker emits on close the value with which it was opened (stale);
        // this is not user input. Compare with openedTimeRef (set on open).
        if (v.format("HH:mm:ss") === openedTimeRef.current) return;
        // Apply the entered hour/minute/second to the current base (preserving the date).
        const base = committedRef.current || getNow();
        const next = base.clone().hour(v.hour()).minute(v.minute()).second(v.second());
        // Disabled by disabledTime - ignore the input.
        if (isDisabledValue(next)) return;
        setCommittedValue(next);
        setPendingValue(next);
        onChange && onChange(next, next.format(format));
      }}
      disabled={disabled}
      open={isOpen}
      // We control opening ourselves - react only to newOpen=true.
      // Closing is handled by click-outside/Escape/OK.
      onOpenChange={(newOpen) => {
        if (newOpen) setOpenState(true);
      }}
      classNames={{
        ...rest.classNames,
        popup: {
          ...rest.classNames?.popup,
          root: [
            "loop-timepicker",
            popupClassName,
            rest.classNames?.popup?.root
          ].filter(Boolean).join(" "),
        },
      }}
      // In readOnly mode use displayFormat (with localized AM/PM),
      // in editable - the raw format so the AntD parser can parse the input.
      format={editable ? format : displayFormat}
      inputReadOnly={!editable}
      use12Hours={effectiveUse12}
      showNow={false}
      /**
       * needConfirm={true} is required by AntD when the panel is replaced.
       * We do NOT pass onOk: it is never called either on Enter or on close.
       * The OK and "Now" buttons are drawn in panelRender and managed manually.
       * See the note above the component regarding stale onChange events.
       */
      needConfirm={true}
      panelRender={panelRender}
    />
  );
});

LoopTimePicker.displayName = "LoopTimePicker";

export default LoopTimePicker;

// TODO (disabledTime performance):
// In a single panelRender render, disabledTime and its fields can be called
// up to ~35 times (isDisabledValue for "Now"/OK, disabledConfig, hourOptions x 24,
// disabledMinuteSet, disabledSecondSet). Plus ~7 calls per click through
// normalizeAfterChange and updateField. If profiling shows lag
// (heavy disabledTime with Intl/tz/network, low-end Android, several open
// pickers at once):
//   1) Split disabledConfig into "by hour" (for hourOptions and minuteItems)
//      and "by minute" (for secondItems) - so a click on minutes doesn't recreate
//      hourOptions and doesn't re-render the hour column.
//   2) Extract the disabled flags for "Now" and OK into useMemo on (getNow, pendingValue).
//   3) Verify that disabledTime does not create an Intl.DateTimeFormat inside
//      each call - that is the most expensive operation.
// Optimization is not currently required - left as is.