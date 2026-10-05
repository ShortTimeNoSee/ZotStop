export type Bounds = [number, number, number, number]
type Entry<T> = { value: T; order: number; bounds: Bounds }
type Node<T> = { bounds: Bounds; entries?: Entry<T>[]; children?: [Node<T>, Node<T>] }

const overlaps = (a: Bounds, b: Bounds) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]

export function spatialIndex<T extends { bounds: Bounds }>(values: T[]) {
  const build = (entries: Entry<T>[]): Node<T> => {
    const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
    for (const entry of entries) {
      bounds[0] = Math.min(bounds[0], entry.bounds[0])
      bounds[1] = Math.min(bounds[1], entry.bounds[1])
      bounds[2] = Math.max(bounds[2], entry.bounds[2])
      bounds[3] = Math.max(bounds[3], entry.bounds[3])
    }
    if (entries.length <= 16) return { bounds, entries }
    const axis = bounds[2] - bounds[0] >= bounds[3] - bounds[1] ? 0 : 1
    entries.sort((a, b) => a.bounds[axis] + a.bounds[axis + 2] - b.bounds[axis] - b.bounds[axis + 2])
    const middle = Math.floor(entries.length / 2)
    return { bounds, children: [build(entries.slice(0, middle)), build(entries.slice(middle))] }
  }
  const root = build(values.map((value, order) => ({ value, order, bounds: value.bounds })))
  return (bounds: Bounds): T[] => {
    if (!overlaps(root.bounds, bounds)) return []
    if (bounds[0] <= root.bounds[0] && bounds[1] <= root.bounds[1] && bounds[2] >= root.bounds[2] && bounds[3] >= root.bounds[3]) return values
    const width = Math.max(0, Math.min(bounds[2], root.bounds[2]) - Math.max(bounds[0], root.bounds[0]))
    const height = Math.max(0, Math.min(bounds[3], root.bounds[3]) - Math.max(bounds[1], root.bounds[1]))
    const area = (root.bounds[2] - root.bounds[0]) * (root.bounds[3] - root.bounds[1])
    // Broad views cost less to scan than to traverse and restore drawing order.
    if (width * height >= area / 8) return values.filter(value => overlaps(value.bounds, bounds))
    const found: Entry<T>[] = []
    const visit = (node: Node<T>) => {
      if (found.length > values.length / 8) return
      if (!overlaps(node.bounds, bounds)) return
      if (node.entries) {
        for (const entry of node.entries) if (overlaps(entry.bounds, bounds)) found.push(entry)
      } else for (const child of node.children!) visit(child)
    }
    visit(root)
    if (found.length > values.length / 8) return values.filter(value => overlaps(value.bounds, bounds))
    return found.sort((a, b) => a.order - b.order).map(entry => entry.value)
  }
}
