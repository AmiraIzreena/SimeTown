-- Lapor issues: reports about the same problem at the same place are grouped into one issue. Neighbours see an
-- issue (its written title, never anyone's own words) only once enough different residents are affected, and staff
-- get those, plus anything urgent, as "Needs attention". Every report belongs to exactly one issue.
CREATE TABLE report_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  township_id uuid NOT NULL REFERENCES townships (id),
  category text NOT NULL CHECK (category IN ('POTHOLE', 'LIGHTING', 'DRAINAGE', 'WASTE', 'ACCESS_BARRIER', 'SAFETY', 'OTHER')),
  zone_id uuid REFERENCES flood_zones (id),
  -- Written from the reports by the model (or corrected by staff), in English and Malay. Null: the app shows
  -- "<type> in <area>" instead, so a resident's raw text is never the public title.
  title text,
  title_ms text,
  summary text,
  summary_ms text,
  title_source text CHECK (title_source IN ('MODEL', 'STAFF')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_issues_township_idx ON report_issues (township_id, created_at DESC);

-- Every existing report becomes its own issue (same id, so the link is simple).
INSERT INTO report_issues (id, township_id, category, zone_id, created_at, updated_at)
  SELECT id, township_id, category, zone_id, created_at, updated_at FROM reports;
ALTER TABLE reports ADD COLUMN issue_id uuid REFERENCES report_issues (id);
UPDATE reports SET issue_id = id;
ALTER TABLE reports ALTER COLUMN issue_id SET NOT NULL;
CREATE INDEX reports_issue_idx ON reports (issue_id);

-- How many different residents (reporters and "Me too") an issue needs before neighbours see it.
ALTER TABLE program_settings
  ADD COLUMN issue_public_threshold integer NOT NULL DEFAULT 5 CHECK (issue_public_threshold BETWEEN 1 AND 100);

-- One row per issue with what its reports add up to. Status: in progress if any report is, else received if any is,
-- else resolved if any was fixed, else closed with no action. People: everyone who reported it or said "Me too".
CREATE VIEW report_issue_facts AS
SELECT i.id, i.township_id, i.category, i.zone_id, i.title, i.title_ms, i.summary, i.summary_ms, i.title_source, i.created_at,
       f.status, f.urgent, f.reports, f.first_report_id, f.updated_at, f.resolved_at, f.target_date, f.assigned_to,
       (SELECT count(*)::int FROM (
          SELECT r.reporter_id AS person FROM reports r WHERE r.issue_id = i.id
          UNION
          SELECT s.user_id FROM report_supporters s JOIN reports r ON r.id = s.report_id WHERE r.issue_id = i.id
        ) people) AS people
  FROM report_issues i
  JOIN LATERAL (
    SELECT CASE WHEN bool_or(r.status = 'IN_PROGRESS') THEN 'IN_PROGRESS'
                WHEN bool_or(r.status = 'NEW') THEN 'NEW'
                WHEN bool_or(r.status = 'RESOLVED') THEN 'RESOLVED'
                ELSE 'REJECTED' END AS status,
           coalesce(bool_or(r.urgency = 'URGENT' AND r.status IN ('NEW', 'IN_PROGRESS')), false) AS urgent,
           count(*)::int AS reports,
           (array_agg(r.id ORDER BY r.created_at, r.id))[1] AS first_report_id,
           greatest(max(r.updated_at), i.updated_at) AS updated_at,
           max(r.resolved_at) AS resolved_at,
           min(r.target_date) FILTER (WHERE r.status IN ('NEW', 'IN_PROGRESS')) AS target_date,
           max(r.assigned_to) FILTER (WHERE r.status IN ('NEW', 'IN_PROGRESS')) AS assigned_to
      FROM reports r WHERE r.issue_id = i.id
  ) f ON f.reports > 0;
