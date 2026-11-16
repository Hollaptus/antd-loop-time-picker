# antd-loop-time-picker

[![npm version](https://img.shields.io/npm/v/antd-loop-time-picker)](https://www.npmjs.com/package/antd-loop-time-picker)
[![license](https://img.shields.io/npm/l/antd-loop-time-picker)](./LICENSE)

A looping (infinite scroll) time picker for [Ant Design](https://ant.design/), built for touch screens.
It wraps the antd `TimePicker` and replaces its panel with columns that scroll endlessly and snap to the selected item.

> Not affiliated with Ant Design.

<!-- TODO: screenshot or GIF of the picker (mobile viewport) -->

## Features

- Endless looping columns for hours, minutes and seconds, with snap-to-center
- antd `TimePicker` props such as `allowClear`, `placeholder`, `size`, `status`, `className` and `style` are passed through
- Commit with an OK button (`needConfirm`, default) or instantly; optional `changeOnScroll`
- 12-hour mode with localized AM/PM labels
- `hourStep` / `minuteStep` / `secondStep` and `disabledTime`
- Works inside `Form.Item`
- `dayjs.utc` / `dayjs.tz` values through the `now` prop
- TypeScript types included

## Compatibility

| Package | Peer range | Tested with |
|---|---|---|
| `antd` | `^5.27.6` | 5.27.6 |
| `react`, `react-dom` | `^19.1.0` | 19.1.0, 19.3.1 |
| `dayjs` | `^1.11.13` | 1.11.13, 1.11.23 |

antd 6 has **not** been tested. The stylesheet targets antd's internal `.ant-picker-time-panel-*` classes, which may change between antd versions.

## Installation

```bash
npm install antd-loop-time-picker
```

## Quick start

```jsx
import { Form } from "antd";
import LoopTimePicker from "antd-loop-time-picker";
import "antd-loop-time-picker/style.css"; // required

export default function Example() {
  return (
    <Form>
      <Form.Item name="time" label="Time">
        <LoopTimePicker format="HH:mm" allowClear />
      </Form.Item>
    </Form>
  );
}
```

**The stylesheet import is required.** Without it the panel layout breaks. The styles are scoped to the `loop-timepicker` class that is added to the popup.

## Examples

### 12-hour format

```jsx
<LoopTimePicker format="hh:mm a" />
```

### Instant commit and scroll selection

```jsx
<LoopTimePicker format="HH:mm" needConfirm={false} changeOnScroll />
```

### Steps

```jsx
<LoopTimePicker format="HH:mm" hourStep={2} minuteStep={10} />
```

### Disabled time

```jsx
const range = (start, end) => Array.from({ length: end - start }, (_, i) => start + i);

<LoopTimePicker
  format="HH:mm"
  disabledTime={() => ({
    disabledHours: () => [...range(0, 9), ...range(19, 24)], // 09:00–18:59 only
    disabledMinutes: (hour) => (hour === 18 ? range(1, 60) : []), // 18:00 only in the last hour
  })}
/>
```

### Manual input

```jsx
<LoopTimePicker format="HH:mm" editable />
```

### UTC and time zones

Pass `dayjs` objects and a `now` factory, so that "Now" and the first selection use the same mode:

```jsx
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
dayjs.extend(utc);

<LoopTimePicker
  format="HH:mm"
  value={dayjs.utc("2026-11-07T14:00:00Z")}
  now={() => dayjs.utc()}
  onChange={(value) => console.log(value?.isUTC(), value?.toISOString())}
/>;
```

For time zones use `dayjs/plugin/timezone` (after `utc`) and `now={() => dayjs().tz("Asia/Tokyo")}`.

## Props

All other props are passed to the antd `TimePicker` (`allowClear`, `placeholder`, `size`, `status`, `className`, `style`, `id`, …). `ref` is forwarded to the antd picker.

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `Dayjs \| Date \| string \| null` | — | Controlled value. Strings are parsed by `format`, then by `dayjs(value)`. |
| `defaultValue` | same as `value` | — | Initial value for uncontrolled usage. |
| `onChange` | `(value: Dayjs \| null, dateString: string) => void` | — | Called when a value is committed (OK, or every change with `needConfirm={false}`) and on clear (`null`, `""`). |
| `onOk` | `(value: Dayjs \| null) => void` | — | Called by the OK button before the value is committed. |
| `format` | `string` | `"HH:mm:ss"` (`"hh:mm:ss a"` with `use12Hours`) | dayjs format. Columns are derived from it: `H`/`h` hours, `m` minutes, `s` seconds, `a`/`A` AM/PM. Text in `[brackets]` is ignored. |
| `use12Hours` | `boolean` | from `format` | 12-hour mode. By default it is on when `format` contains `a`/`A`. |
| `showNow` | `boolean` | `true` | Show the "Now" button. |
| `needConfirm` | `boolean` | `true` | Require OK to commit. With `false` every change is committed immediately. |
| `changeOnScroll` | `boolean` | `false` | Change the selected value when scrolling stops. |
| `hourStep`, `minuteStep`, `secondStep` | `number` | `1` | Step of the column items. |
| `disabledTime` | `{ disabledHours?, disabledMinutes?, disabledSeconds? } \| (date) => {…}` | — | Same shape as in antd. See [limitations](#known-issues-and-limitations). |
| `editable` | `boolean` | `false` | Allow typing into the input. |
| `now` | `() => Dayjs` | `() => dayjs()` | Factory for "the current moment" (UTC / time zone mode). |
| `open`, `onOpenChange` | `boolean`, `(open: boolean) => void` | — | Controlled popup visibility. |
| `renderExtraFooter` | `() => ReactNode` | — | Extra content in the popup footer. |
| `popupClassName` | `string` | — | Extra class for the popup. |
| `disabled` | `boolean` | `false` | Disable the picker. |

## Localization and theming

- The "Now" and "OK" texts come from the antd `ConfigProvider` locale (`DatePicker.lang.now` / `.ok`). Without a locale they fall back to English.
- AM/PM labels are taken from `Intl` (CLDR) for the locale in this order: the antd `ConfigProvider` locale, the locale of the value, `dayjs.locale()`. For example `AM`/`PM` for English and Russian, `上午`/`下午` for `zh-cn`.
- The "Now" button follows the link color of the active antd theme.
- Import antd locales as in the antd docs (`antd/locale/ru_RU`). If the locale is wrapped in a `default` object (see [Known issues](#known-issues-and-limitations)), use `antd/es/locale/ru_RU`.

```jsx
import { ConfigProvider } from "antd";
import ruRU from "antd/locale/ru_RU";
import dayjs from "dayjs";
import "dayjs/locale/ru";

dayjs.locale("ru");

<ConfigProvider locale={ruRU}>
  <LoopTimePicker format="HH:mm" />
</ConfigProvider>;
```

## Differences from the standard antd TimePicker

- **The panel is custom.** The columns loop and snap to the center; the antd panel is replaced via `panelRender`.
- **"Now" does not commit and close.** It fills the draft value. With `needConfirm` (default) press OK to apply it; with `needConfirm={false}` the value is committed immediately, but the panel stays open.
- **With `needConfirm={false}` the panel does not close on selection.** Close it with an outside click or Esc.
- **The input is read-only by default.** Enable typing with `editable`. Typed text is applied on Enter or when you click outside; the columns of an open panel update only after that.
- **Short columns are static.** Columns with fewer than 8 items (for example with `hourStep={4}`, or the AM/PM column) are not looped and not scrollable, and `changeOnScroll` does not apply to them.

## Keyboard

- Click, Space or Enter on the input opens the popup. Esc closes it.
- After you click inside the popup, Tab moves between its focusable elements (columns, "Now", OK).
- Arrow keys scroll the focused column natively (the step depends on the browser and can skip items, as in the standard antd TimePicker). The column snaps to the nearest item, and with `changeOnScroll` the value follows.
- Individual items cannot be picked with the keyboard (same as in antd). Use `editable` to type a time.

## Known issues and limitations

### AM/PM labels and dayjs

- With `editable={false}` the AM/PM column and the input text use the same labels (from `Intl`).
- With `editable` the input uses `dayjs` formatting and parsing for the active locale. Some locales have more than two day periods (Russian: night, morning, afternoon, evening), so the input can differ from the column (for example "вечера" vs "PM").

### Typing 12-hour times in some locales

`dayjs` (`customParseFormat`) cannot parse some typed 12-hour times when the locale defines its own `meridiem` function; see [dayjs#2031](https://github.com/iamkun/dayjs/issues/2031). With `editable`, `hh:mm A` and the Russian locale (dayjs 1.11.23) `01:00 дня`, `03:00 дня`, `12:00 дня` and `04:00 PM` are not accepted. The standard antd `TimePicker` has the same limitation.

- Prefer a 24-hour format (`HH:mm`) for typed input.
- Or remove the custom `meridiem` of the locale so that dayjs falls back to AM/PM for formatting and parsing (global effect for your app):

  ```js
  import dayjs from "dayjs";
  import updateLocale from "dayjs/plugin/updateLocale";

  dayjs.extend(updateLocale);
  dayjs.updateLocale("ru", { meridiem: undefined });
  ```

### antd internals

On antd 5.27.6, when the popup closes `rc-picker` emits `onChange` with the value it was opened with (its own draft). The component ignores such events (`null`/`undefined` checks and the value at open time) and recreates the inner picker when the committed value changes while the popup is closed. `onOk` is intentionally not passed to the inner `TimePicker`: in our tests it was never called, neither on Enter nor on close, and the effect of passing it was not verified. Re-check this when upgrading antd.

### `disabledTime`

- It blocks selection in the columns, typed input, "Now" and OK. It does **not** validate initial or external values; use a `Form.Item` rule for that.
- The AM/PM column ignores `disabledTime`. If the selected half of the day is disabled, OK stays disabled until a valid time is chosen.
- When the hour or AM/PM changes, invalid minutes and seconds are moved to the first available value. Hours are not adjusted.
- `needConfirm={false}` does not commit a value that violates `disabledTime`.
- `disabledTime` and its fields are called many times per render (columns, buttons). Keep it cheap, especially on low-end devices.

### Steps and short columns

- A value that is not on the step (for example 14:07 with `minuteStep={5}`) is not highlighted, but it is kept as is.
- Columns with fewer than 8 items are static (see above).

### Values and time zones

- Strings and `Date` values are treated as local time. For UTC or time zones pass `dayjs` objects and the `now` prop.
- Inside `Form.Item` the mode (local, UTC, time zone) is whatever the form stores: the component preserves the mode of the value it receives.

### Locale import in Vite

In some setups (observed in a Vite project) a CommonJS antd locale arrives wrapped in a `{ default: … }` object. antd then falls back to English texts for all components. In development the component logs a one-time warning. Import `antd/es/locale/<lang>` or unwrap it: `locale={ruRU.default ?? ruRU}`.

### Not tested

Not exhaustively tested on real devices (for example iOS Safari) and with server-side rendering.

## Development

```bash
npm install
npm run build   # tsup, then copies style.css and index.d.ts into dist/
```

There is no automated test suite yet. To try a build locally run `npm pack` and install the generated `.tgz` into a test project.

## License

[MIT](./LICENSE)