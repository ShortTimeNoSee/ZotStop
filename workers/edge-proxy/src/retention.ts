type AggregateDatabase = {
  prepare: (sql: string) => { bind: (day: string) => { run: () => Promise<unknown> } }
}

export async function purgeUsageCounts(database: AggregateDatabase, now: number) {
  const today = new Date(now).toISOString().slice(0, 10)
  const firstDay = new Date(Date.parse(today) - 29 * 86400000).toISOString().slice(0, 10)
  await database.prepare('DELETE FROM ux_aggregate WHERE day < ?').bind(firstDay).run()
}
