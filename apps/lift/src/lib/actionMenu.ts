// pure half of components/ActionMenu: android's Alert.alert keeps at most
// three buttons, so any menu longer than that goes through here instead.

export interface MenuAction {
  label: string;
  onPress: () => void;
  destructive?: boolean;
}

export const CANCEL_LABEL = "cancel";

export interface SheetOptions {
  options: string[];
  cancelButtonIndex: number;
  destructiveButtonIndex: number[];
}

/** ActionSheetIOS options: the actions in order, cancel last */
export function sheetOptions(actions: readonly MenuAction[], cancelLabel = CANCEL_LABEL): SheetOptions {
  const destructive: number[] = [];
  actions.forEach((a, i) => {
    if (a.destructive) destructive.push(i);
  });
  return {
    options: [...actions.map((a) => a.label), cancelLabel],
    cancelButtonIndex: actions.length,
    destructiveButtonIndex: destructive,
  };
}

/** the action behind a sheet button index; cancel or out of range -> undefined */
export function actionAt(actions: readonly MenuAction[], index: number): MenuAction | undefined {
  return Number.isInteger(index) && index >= 0 ? actions[index] : undefined;
}

/** drops falsy entries so call sites can write `cond && { ... }` inline */
export function compactActions(list: readonly (MenuAction | false | null | undefined)[]): MenuAction[] {
  return list.filter((a): a is MenuAction => !!a);
}
