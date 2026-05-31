export function filterCheckedItems(all: string[], checked: string[]): string[] {
  return all.filter((item) => checked.includes(item))
}
