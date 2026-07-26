const TOOL_ACTIVITY: Record<string, readonly [active: string, complete: string]> = {
  insforge_list_tables: ["Scanning the live database", "Scanned the live database"],
  insforge_run_sql: ["Running SQL under your login", "Ran SQL under your login"],
  insforge_query_and_chart: [
    "Querying live data and assembling your dashboard",
    "Queried live data and assembled your dashboard",
  ],
  create_flint_chart: ["Assembling your dashboard", "Assembled your dashboard"],
  set_reminder: ["Scheduling the follow-up watch", "Scheduled the follow-up watch"],
  get_current_time: ["Checking the clock", "Checked the clock"],
  "Get Current Time": ["Checking the clock", "Checked the clock"],
  "Set Reminder": ["Scheduling the follow-up watch", "Scheduled the follow-up watch"],
  runtype_record_upsert: ["Saving the analysis snapshot", "Saved the analysis snapshot"],
  runtype_record_get: ["Reviewing prior snapshots", "Reviewed prior snapshots"],
  runtype_record_list: ["Reviewing prior snapshots", "Reviewed prior snapshots"],
};

export const getToolActivityLabel = (
  toolName: string | undefined,
): readonly [active: string, complete: string] | undefined => {
  const bareName = toolName?.replace(/^webmcp:/, "");
  return bareName ? TOOL_ACTIVITY[bareName] : undefined;
};
