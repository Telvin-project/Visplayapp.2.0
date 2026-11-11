"""Render VisPlay employer's Markdown runbook to a readable A4 PDF.

Usage: python scripts/build-novice-runbook-pdf.py INPUT.md OUTPUT.pdf [H_APPENDIX.md]
This is documentation tooling and does not load application secrets or state.
"""

from __future__ import annotations

import html
import re
import subprocess
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    LongTable,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


INK = colors.HexColor("#172338")
CYAN = colors.HexColor("#087C92")
MUTED = colors.HexColor("#63748B")
LIGHT = colors.HexColor("#EEF3F7")
WHITE = colors.white
RULE = colors.HexColor("#D6DEE6")
PAPER_WIDTH, PAPER_HEIGHT = A4
LEFT = RIGHT = 48
TOP = 66
BOTTOM = 54
CONTENT_WIDTH = PAPER_WIDTH - LEFT - RIGHT


def font_file(family: str, style: str) -> str:
    found = subprocess.check_output(
        ["fc-match", "-f", "%{file}", f"{family}:style={style}"], text=True
    ).strip()
    if not Path(found).is_file():
        raise RuntimeError(f"Missing font for {family} {style}")
    return found


pdfmetrics.registerFont(TTFont("VP", font_file("Noto Sans", "Regular")))
pdfmetrics.registerFont(TTFont("VP-Bold", font_file("Noto Sans", "Bold")))
pdfmetrics.registerFont(TTFont("VP-Italic", font_file("Noto Sans", "Italic")))
pdfmetrics.registerFontFamily("VP", normal="VP", bold="VP-Bold", italic="VP-Italic", boldItalic="VP-Bold")

BASE = dict(fontName="VP", textColor=INK, splitLongWords=1, allowWidows=0, allowOrphans=0)
BODY = ParagraphStyle("Body", fontSize=8.75, leading=13.6, spaceAfter=6, **BASE)
LEAD = ParagraphStyle("Lead", parent=BODY, fontSize=10.1, leading=16.2, spaceAfter=10)
H1 = ParagraphStyle("Phase", parent=BODY, fontName="VP-Bold", fontSize=14.7, leading=19.5, textColor=INK, spaceBefore=21, spaceAfter=9, keepWithNext=True)
H2 = ParagraphStyle("Section", parent=BODY, fontName="VP-Bold", fontSize=11.3, leading=15, textColor=CYAN, spaceBefore=15, spaceAfter=6, keepWithNext=True)
H3 = ParagraphStyle("Subsection", parent=BODY, fontName="VP-Bold", fontSize=9.5, leading=13.7, spaceBefore=12, spaceAfter=5, keepWithNext=True)
BULLET = ParagraphStyle("Bullet", parent=BODY, leftIndent=17, firstLineIndent=-13, spaceAfter=4.5)
TABLECELL = ParagraphStyle("Cell", parent=BODY, fontSize=7.15, leading=10.4, spaceAfter=0)
TABLEHEAD = ParagraphStyle("Head", parent=TABLECELL, fontName="VP-Bold", textColor=WHITE)
WARNING = ParagraphStyle("Warning", parent=BODY, textColor=INK, leftIndent=12, rightIndent=12, spaceBefore=10, spaceAfter=12, leading=14.5)
META = ParagraphStyle("Meta", parent=BODY, fontSize=9.2, leading=14.2, spaceAfter=8, textColor=MUTED)
COVER_TITLE = ParagraphStyle("CoverTitle", parent=BODY, fontName="VP-Bold", fontSize=27, leading=34, textColor=INK, spaceAfter=12)
COVER_SUB = ParagraphStyle("CoverSub", parent=BODY, fontSize=13.5, leading=20, textColor=CYAN, spaceAfter=20)
COVER_BRAND = ParagraphStyle("CoverBrand", parent=BODY, fontName="VP-Bold", fontSize=13, leading=18, textColor=CYAN, spaceAfter=22)


INLINE_PATTERN = re.compile(
    r"(\[[^\]]+\]\(https?://[^\s)]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)"
)


def inline_markup(value: str) -> str:
    """Minimal, safe ReportLab markup, preserving URLs and common Markdown."""
    out = []
    index = 0
    for match in INLINE_PATTERN.finditer(value):
        out.append(html.escape(value[index : match.start()]))
        part = match.group(0)
        if part.startswith("["):
            label, _, url = part[1:-1].partition("](")
            out.append(
                f'<link href="{html.escape(url, quote=True)}" color="#087C92">'
                f'<u>{html.escape(label)}</u></link>'
            )
        elif part.startswith("**"):
            out.append(f"<b>{html.escape(part[2:-2])}</b>")
        elif part.startswith("`"):
            out.append(f'<font color="#04687C">{html.escape(part[1:-1])}</font>')
        else:
            out.append(f"<i>{html.escape(part[1:-1])}</i>")
        index = match.end()
    out.append(html.escape(value[index:]))
    return "".join(out).replace("  ", " ")


def table_cells(line: str) -> list[str]:
    return [item.strip() for item in line.strip().strip("|").split("|")]


def is_table_rule(line: str) -> bool:
    return bool(re.match(r"^\|\s*[-:\s|]+\|\s*$", line))


def table_widths(column_count: int, header: list[str]) -> list[float]:
    if column_count == 2:
        return [CONTENT_WIDTH * 0.32, CONTENT_WIDTH * 0.68]
    if column_count == 3:
        return [CONTENT_WIDTH * 0.22, CONTENT_WIDTH * 0.38, CONTENT_WIDTH * 0.4]
    if column_count == 4:
        if header[0].strip().lower() == "id":
            return [CONTENT_WIDTH * fraction for fraction in [0.08, 0.23, 0.34, 0.35]]
        return [CONTENT_WIDTH * fraction for fraction in [0.19, 0.22, 0.31, 0.28]]
    if column_count == 5:
        # Keep role names such as CREATOR/ADMIN and ENGINEER/LEGAL intact.
        return [CONTENT_WIDTH * fraction for fraction in [0.08, 0.09, 0.17, 0.54, 0.12]]
    return [CONTENT_WIDTH / column_count] * column_count


def make_table(lines: list[str]) -> LongTable:
    header = table_cells(lines[0])
    column_count = len(header)
    rows = [header]
    for line in lines[1:]:
        if is_table_rule(line):
            continue
        current = table_cells(line)
        if len(current) < column_count:
            current += [""] * (column_count - len(current))
        rows.append(current[:column_count])
    cells = [
        [Paragraph(inline_markup(cell), TABLEHEAD if row_number == 0 else TABLECELL) for cell in row]
        for row_number, row in enumerate(rows)
    ]
    table = LongTable(
        cells,
        colWidths=table_widths(column_count, header),
        repeatRows=1,
        hAlign="LEFT",
        splitByRow=1,
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("LINEBELOW", (0, 0), (-1, 0), 0.6, CYAN),
                ("LINEBELOW", (0, 1), (-1, -1), 0.3, RULE),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, LIGHT]),
            ]
        )
    )
    return table


def page_decoration(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(CYAN)
    canvas.rect(LEFT, PAPER_HEIGHT - 40, CONTENT_WIDTH, 3, fill=1, stroke=0)
    canvas.setFont("VP-Bold", 8)
    canvas.setFillColor(INK)
    canvas.drawString(LEFT, PAPER_HEIGHT - 53, "VISPLAY  /  RELEASE READINESS")
    canvas.setFont("VP", 8)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(PAPER_WIDTH - RIGHT, PAPER_HEIGHT - 53, "11 NOVEMBER 2026")
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.4)
    canvas.line(LEFT, 43, PAPER_WIDTH - RIGHT, 43)
    canvas.setFont("VP", 7.2)
    canvas.drawString(LEFT, 31, "STAGING ONLY  /  NO LIVE FINANCIAL APPROVAL")
    canvas.drawRightString(PAPER_WIDTH - RIGHT, 31, f"PAGE {doc.page}")
    canvas.restoreState()


def build_story(source: str):
    story = []
    lines = source.splitlines()
    story += [
        Spacer(1, 72),
        Paragraph("VISPLAY  /  ENGINEERING HANDOVER", COVER_BRAND),
        Paragraph("Complete Beginner's<br/>Test, Integration &amp; Launch Runbook", COVER_TITLE),
        Paragraph("Step-by-step instructions for the employer and appointed technical team", COVER_SUB),
        HRFlowable(width="100%", thickness=2, color=CYAN, spaceBefore=0, spaceAfter=22),
        Paragraph("VERSION 1.3  •  11 NOVEMBER 2026", META),
        Paragraph("<b>Current verdict:</b> NOT PRODUCTION READY. Employer-run tests: ZERO reported.", LEAD),
        Paragraph("Use only isolated staging accounts and test payments. Money, privacy and media protection require independent expert sign-off.", LEAD),
        Spacer(1, 48),
        Paragraph("Included: Sections A–H source verification, provider setup, user journeys, native-reader and safety tests, Section H operational appendix, outstanding I–J work and release decision forms.", META),
        PageBreak(),
        Paragraph("Quick navigation", H1),
    ]
    for line in lines:
        if line.startswith("## Phase "):
            story.append(Paragraph(inline_markup(line.replace("## ", "")), BULLET))
    story += [
        Spacer(1, 10),
        Paragraph("Tip: Use PDF search for a phrase such as <b>Paystack</b>, <b>Creator Studio</b>, <b>DELETE</b> or <b>BLOCKED</b>.", META),
        PageBreak(),
    ]
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("# "):
            # Original document heading is represented by the designed cover.
            i += 1
            continue
        if stripped == "---":
            story.append(HRFlowable(width="100%", thickness=0.7, color=RULE, spaceBefore=9, spaceAfter=9))
            i += 1
            continue
        if line.startswith("|") and i + 1 < len(lines) and is_table_rule(lines[i + 1]):
            table_lines = [line]
            i += 1
            while i < len(lines) and lines[i].startswith("|"):
                table_lines.append(lines[i].rstrip())
                i += 1
            story += [Spacer(1, 6), make_table(table_lines), Spacer(1, 11)]
            continue
        heading = re.match(r"^(#{2,4})\s+(.+)$", stripped)
        if heading:
            level = len(heading.group(1))
            style = H1 if level == 2 else H2 if level == 3 else H3
            story.append(Paragraph(inline_markup(heading.group(2)), style))
            i += 1
            continue
        if stripped.startswith("> "):
            quoted = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                quoted.append(lines[i].lstrip().lstrip("> "))
                i += 1
            story.append(Table([[Paragraph(inline_markup(" ".join(quoted)), WARNING)]], colWidths=[CONTENT_WIDTH], style=TableStyle([
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
                ("LINEBEFORE", (0, 0), (0, -1), 3, CYAN),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ])))
            i += 0
            continue
        if line.startswith("- ") or re.match(r"^\d+\. ", stripped):
            marker = "•" if line.startswith("- ") else re.match(r"^(\d+)\.", stripped).group(1) + "."
            body = line[2:] if line.startswith("- ") else re.sub(r"^\d+\.\s+", "", line)
            story.append(Paragraph(f'<font color="#087C92"><b>{marker}</b></font>&nbsp; {inline_markup(body)}', BULLET))
            i += 1
            continue
        # Normal paragraph: combine only directly contiguous ordinary lines.
        paragraph_lines = [stripped]
        i += 1
        while i < len(lines):
            next_line = lines[i].strip()
            if not next_line or next_line.startswith(("#", "|", ">", "- ")) or re.match(r"^\d+\. ", next_line):
                break
            paragraph_lines.append(next_line)
            i += 1
        joined = " ".join(paragraph_lines)
        style = META if joined.startswith(("**Version:", "**Audience:", "**Project:", "**Critical status:")) else BODY
        story.append(Paragraph(inline_markup(joined), style))
    return story


def main():
    if len(sys.argv) not in (3, 4):
        raise SystemExit("Usage: python scripts/build-novice-runbook-pdf.py INPUT.md OUTPUT.pdf [H_APPENDIX.md]")
    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    output.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(output),
        pagesize=A4,
        leftMargin=LEFT,
        rightMargin=RIGHT,
        topMargin=TOP,
        bottomMargin=BOTTOM,
        title="VisPlay - Complete Beginner's Test, Integration & Launch Runbook",
        author="VisPlay Engineering Remediation",
        subject="Staging-first employer acceptance guide and outstanding release gates",
    )
    frame = Frame(LEFT, BOTTOM, CONTENT_WIDTH, PAPER_HEIGHT - TOP - BOTTOM, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates(PageTemplate(id="VP", frames=[frame], onPage=page_decoration))
    document_text = source.read_text(encoding="utf-8")
    if len(sys.argv) == 4:
        appendix_text = Path(sys.argv[3]).read_text(encoding="utf-8")
        document_text += "\n\n## Appendix — Section H provider and operations walkthrough\n\n"
        document_text += "\n".join(
            line for line in appendix_text.splitlines()
            if not line.startswith("# Section H —")
            and not line.startswith("**Release condition:**")
        )
    doc.build(build_story(document_text))
    print(f"Wrote {output} ({output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
