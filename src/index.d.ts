import type * as React from "react";
import type { TimePickerProps } from "antd";
import type { Dayjs } from "dayjs";

/** 
 * Accepted value types.
 * `Dayjs` objects keep their utc/timezone mode;
 * `string`'s and `Date`'s are treated as local time.
 */
export type LoopTimePickerValue = Dayjs | Date | string | null;

/**
 * Configuration for disabling specific hours, minutes, and seconds.
 * Corresponds to the standard `disabledTime` interface from Ant Design.
 */
export interface LoopTimePickerDisabledTime {
    disabledHours?: () => number[];
    disabledMinutes?: (hour: number) => number[];
    disabledSeconds?: (hour: number, minute: number) => number[];
}

/**
 * List of props that we override or hide from the standard TimePicker.
 * This is needed to prevent TypeScript from complaining about type mismatches
 * (e.g., the standard onChange from AntD accepts different arguments).
 */
type OverriddenProps =
    | "value"
    | "defaultValue"
    | "onChange"
    | "onOk"
    | "open"
    | "onOpenChange"
    | "showNow"
    | "needConfirm"
    | "editable"
    | "changeOnScroll"
    | "format"
    | "popupClassName"
    | "renderExtraFooter"
    | "use12Hours"
    | "hourStep"
    | "minuteStep"
    | "secondStep"
    | "disabledTime"
    | "now";

/**
 * Main props for the LoopTimePicker component.
 * Inherits all other props from the standard AntD TimePicker
 * (e.g., `disabled`, `allowClear`, `placeholder`, etc.).
 */
export interface LoopTimePickerProps extends Omit<TimePickerProps, OverriddenProps> {
    // --- Value & Events ---
    
    /**
     * The current selected value (controlled mode).
     * Can be a `dayjs` object, `Date`, or a `string` in the "HH:mm" format.
     */
    value?: LoopTimePickerValue;

    /**
     * The inital value (uncontrolled mode).
     */
    defaultValue?: LoopTimePickerValue;

    /**
     * An event that fires when the value is commited (by pressing "OK", or automatically if `needConfirm={false}`)
     * Returns a `dayjs` object and a `string` formatted according to the provided format.
     */
    onChange?: (value: Dayjs | null, dateString: string) => void;

    /** 
     * A callback that fires when the "OK" button is pressed.
     * Executes before the value is applied.
     */
    onOk?: (value: Dayjs | null) => void;
    
    // --- Panel State & Behavior ---
    
    /**
     * A controlled open/close state of the panel.
     */
    open?: boolean;

    /**
     * Whether to show the "Now" button in the panel footer.
     * @default true
     */
    showNow?: boolean;
    
    /**
     * Whether to require pressing the OK button to apply the value.
     * If `false`, the value changes only on a press of the "OK" button.
     * @default false
     */
    needConfirm?: boolean;

    /**
     * Allow manual time input using the keyboard.
     * If `false`, the input field acts as read-only.
     * @default false
     */
    editable?: boolean;

    /**
     * Whether to change the value on the fly when column scrolling stops.
     * If `false`, the value changes only on a press or the OK button.
     * @default false
     */
    changeOnScroll?: boolean;

    /** 
     * A callback for panel open state changes.
     */
    onOpenChange?: (open: boolean) => void;

    // --- Appearance & Formatting ---

    /**
     * `dayjs` format string. Defaults to "HH:mm".
     */
    format?: string;

    /**
     * Additional CSS class for the popup panel.
     */
    popupClassName?: string;

    /**
     * Additional content in the panel footer.
     */
    renderExtraFooter?: () => React.ReactNode;

    // --- Steps & Constraints ---
    
    /**
     * Whether to use the 12-hour format (AM/PM).
     */
    use12Hours?: boolean;

    /**
     * A `number` of steps for changing hours.
     */
    hourStep?: number;
    
    /**
     * A `number` of steps for changing minutes.
     */
    minuteStep?: number;
    
    /**
     * A `number` of steps for changing seconds.
     */
    secondStep?: number;

    /**
     * A function/object to disable specific times.
     */
    disabledTime?: LoopTimePickerDisabledTime | ((date: Dayjs) => LoopTimePickerDisabledTime);
    
    /** 
     * "Current moment" factory for utc/tz mode. 
     * Allows proper handling with dayjs.utc() and dayjs.tz().
     * @example now={() => dayjs.utc()}
     */
    now?: () => Dayjs;
}

/**
 * The LoopTimePicker component wrapped in forwardRef.
 * Allows passing a ref to the inner Ant Design input.
 */
declare const LoopTimePicker: React.ForwardRefExoticComponent<
    LoopTimePickerProps & React.RefAttributes<any>
>;

export { LoopTimePicker };
export default LoopTimePicker;