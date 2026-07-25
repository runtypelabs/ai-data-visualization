CREATE TABLE public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_code text NOT NULL UNIQUE,
  name text NOT NULL,
  region text NOT NULL,
  avg_margin_per_ton double precision NOT NULL
);

CREATE TABLE public.site_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  site_code text NOT NULL
);

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_code text NOT NULL UNIQUE,
  site_code text NOT NULL,
  customer text NOT NULL,
  status text NOT NULL,
  start_date date NOT NULL
);

CREATE TABLE public.production_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_code text NOT NULL,
  week_start date NOT NULL,
  target_tons double precision NOT NULL,
  UNIQUE (site_code, week_start)
);

CREATE TABLE public.production_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_code text NOT NULL,
  prod_date date NOT NULL,
  tons double precision NOT NULL,
  job_code text NOT NULL
);

CREATE TABLE public.materials_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_code text NOT NULL,
  use_date date NOT NULL,
  material text NOT NULL,
  qty double precision NOT NULL,
  unit text NOT NULL
);

CREATE TABLE public.safety_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_code text NOT NULL,
  event_date date NOT NULL,
  severity text NOT NULL,
  status text NOT NULL,
  description text NOT NULL
);

CREATE TABLE public.job_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_code text NOT NULL,
  site_code text NOT NULL,
  week_start date NOT NULL,
  cost_usd double precision NOT NULL,
  revenue_usd double precision NOT NULL
);

CREATE TABLE public.flint_charts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  input jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX production_targets_site_week_idx
  ON public.production_targets (site_code, week_start);
CREATE INDEX production_actuals_site_date_idx
  ON public.production_actuals (site_code, prod_date);
CREATE INDEX materials_usage_site_date_idx
  ON public.materials_usage (site_code, use_date);
CREATE INDEX safety_events_site_status_idx
  ON public.safety_events (site_code, status);
CREATE INDEX job_costs_site_week_idx
  ON public.job_costs (site_code, week_start);
CREATE INDEX flint_charts_created_at_idx
  ON public.flint_charts (created_at);

ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_managers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_actuals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flint_charts ENABLE ROW LEVEL SECURITY;
