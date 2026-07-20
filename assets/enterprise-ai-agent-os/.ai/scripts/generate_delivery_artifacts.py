#!/usr/bin/env python3
"""Generate Jira-ready delivery artifacts without third-party dependencies."""

from __future__ import annotations

import argparse
import html
import json
import zipfile
from pathlib import Path


def safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in value).strip("-") or "change"


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8", newline="\n")


def jira_summary(jira_key: str, title: str) -> str:
    return f"""# Jira Completion Package - {jira_key}

Change title: {title}

| Section | Content |
| --- | --- |
| RCA | TODO(owner): verified root cause, contributing factors, and detection/control gap; or N/A - planned change |
| Solution | TODO(owner): implemented correction/design and impacted components |
| MR/PR | TODO(owner): verified link and actual state, or clearly state not created |
| Acceptance criteria | TODO(owner): passed/partial/blocked with evidence |
| Validation | TODO(owner): commands/procedures and actual results |
| Docs/specs/diagrams | TODO(owner): verified links or no-change rationale |
| Demo package | PPTX and XLSX generated with manual screenshot placeholders |
| Deployment/rollback | TODO(owner): summary |
| Risks/blockers/follow-up | TODO(owner): remaining items and owner when known |

## Screenshot Placeholders

| Placeholder ID | Exact screen or evidence to capture | Required state/data | Purpose | Status |
| --- | --- | --- | --- | --- |
| SS-01 | TODO(owner): capture the primary changed workflow screen | TODO(owner): show representative data/state | Demonstrate changed behavior | Pending |
| SS-02 | TODO(owner): capture validation or operational evidence | TODO(owner): show command output, log, dashboard, or test result | Demonstrate verification | Pending |
"""


def slide_xml(title: str, bullets: list[str]) -> str:
    body = "\n".join(
        f"<a:p><a:r><a:t>{html.escape(item)}</a:t></a:r></a:p>" for item in bullets
    )
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr/>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{html.escape(title)}</a:t></a:r></a:p></p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
        <p:txBody><a:bodyPr/><a:lstStyle/>{body}</p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>
"""


def create_pptx(path: Path, jira_key: str, title: str) -> None:
    slides = [
        ("Change Summary", [jira_key, title, "Generated demo deck with manual screenshot placeholders."]),
        ("Problem / RCA", ["TODO(owner): add verified RCA or planned-change rationale."]),
        ("Solution", ["TODO(owner): add implemented correction/design and impacted components."]),
        ("Validation", ["TODO(owner): add commands/procedures and actual results."]),
        ("Screenshot Placeholders", ["SS-01 primary changed workflow screen", "SS-02 validation or operational evidence"]),
        ("Deployment, Rollback, Risks", ["TODO(owner): add deployment plan, rollback plan, and remaining risks."]),
    ]
    slide_ids = "".join(
        f'<p:sldId id="{256 + idx}" r:id="rId{idx}"/>' for idx in range(1, len(slides) + 1)
    )
    relationships = "\n".join(
        f'<Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{idx}.xml"/>'
        for idx in range(1, len(slides) + 1)
    )
    overrides = "\n".join(
        f'<Override PartName="/ppt/slides/slide{idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
        for idx in range(1, len(slides) + 1)
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as deck:
        deck.writestr("[Content_Types].xml", f"""<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  {overrides}
</Types>""")
        deck.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>""")
        deck.writestr("ppt/presentation.xml", f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>{slide_ids}</p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="wide"/>
</p:presentation>""")
        deck.writestr("ppt/_rels/presentation.xml.rels", f"""<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{relationships}
</Relationships>""")
        for idx, (slide_title, bullets) in enumerate(slides, start=1):
            deck.writestr(f"ppt/slides/slide{idx}.xml", slide_xml(slide_title, bullets))


def worksheet(rows: list[list[str]]) -> str:
    xml_rows = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for col_index, value in enumerate(row, start=1):
            col = chr(ord("A") + col_index - 1)
            cells.append(
                f'<c r="{col}{row_index}" t="inlineStr"><is><t>{html.escape(value)}</t></is></c>'
            )
        xml_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>{''.join(xml_rows)}</sheetData>
</worksheet>"""


def create_xlsx(path: Path, jira_key: str, title: str) -> None:
    sheets = {
        "Summary": [["Jira Key", jira_key], ["Change Title", title], ["Status", "TODO(owner): update"]],
        "Acceptance Criteria": [["Criterion", "Status", "Evidence"], ["TODO", "Pending", "TODO(owner): add evidence"]],
        "Validation": [["Command/Procedure", "Result", "Notes"], ["TODO", "Not run", "TODO(owner): add actual result"]],
        "Artifacts": [["Artifact", "Path/Link", "Verified"], ["MR/PR", "TODO(owner)", "No"], ["Docs/Diagrams", "TODO(owner)", "No"]],
        "Screenshot Placeholders": [["ID", "Required Capture", "Status"], ["SS-01", "Primary changed workflow screen", "Pending"], ["SS-02", "Validation or operational evidence", "Pending"]],
    }
    sheet_defs = "".join(
        f'<sheet name="{html.escape(name)}" sheetId="{idx}" r:id="rId{idx}"/>'
        for idx, name in enumerate(sheets, start=1)
    )
    rels = "\n".join(
        f'<Relationship Id="rId{idx}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{idx}.xml"/>'
        for idx in range(1, len(sheets) + 1)
    )
    overrides = "\n".join(
        f'<Override PartName="/xl/worksheets/sheet{idx}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for idx in range(1, len(sheets) + 1)
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as book:
        book.writestr("[Content_Types].xml", f"""<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  {overrides}
</Types>""")
        book.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>""")
        book.writestr("xl/workbook.xml", f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>{sheet_defs}</sheets>
</workbook>""")
        book.writestr("xl/_rels/workbook.xml.rels", f"""<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
{rels}
</Relationships>""")
        for idx, rows in enumerate(sheets.values(), start=1):
            book.writestr(f"xl/worksheets/sheet{idx}.xml", worksheet(rows))


def generate(jira_key: str, title: str, output_dir: Path) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    prefix = safe_name(jira_key)
    summary = output_dir / f"{prefix}-completion-summary.md"
    pptx = output_dir / f"{prefix}-demo-deck.pptx"
    xlsx = output_dir / f"{prefix}-evidence-workbook.xlsx"
    placeholders = output_dir / f"{prefix}-screenshot-placeholders.md"

    write_text(summary, jira_summary(jira_key, title))
    write_text(placeholders, jira_summary(jira_key, title).split("## Screenshot Placeholders", 1)[1].strip() + "\n")
    create_pptx(pptx, jira_key, title)
    create_xlsx(xlsx, jira_key, title)
    return {
        "summary": str(summary),
        "pptx": str(pptx),
        "xlsx": str(xlsx),
        "screenshot_placeholders": str(placeholders),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jira-key", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--json", action="store_true", help="print generated paths as JSON")
    args = parser.parse_args()
    result = generate(args.jira_key, args.title, args.output_dir)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        for label, path in result.items():
            print(f"{label}: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
