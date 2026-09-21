"""Render a branded, four-page deal report from the calculator's own results."""
import io, json, os, sys, re
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import Font
import reportlab
from PIL import Image

ROOT = Path(__file__).parent
FONTDIR = Path(os.environ.get('PYD_FONT_DIR', str(Path(os.environ.get('WINDIR','C:/Windows'))/'Fonts')))
BUNDLED_FONTS = Path(reportlab.__file__).parent/'fonts'
for name, file, fallback in [('Body','arial.ttf','Vera.ttf'), ('Bold','arialbd.ttf','VeraBd.ttf'), ('Title','georgia.ttf',None)]:
    if (FONTDIR/file).is_file():
        pdfmetrics.registerFont(TTFont(name, str(FONTDIR/file)))
    elif fallback:
        pdfmetrics.registerFont(TTFont(name,str(BUNDLED_FONTS/fallback)))
    else:
        pdfmetrics.registerFont(Font(name,'Times-Roman','WinAnsiEncoding'))
    pdfmetrics.registerFontFamily(name,normal=name,bold=name,italic=name,boldItalic=name)
GREEN=colors.HexColor('#0F6E56'); INK=colors.HexColor('#1A1A18'); MUTED=colors.HexColor('#666660')
LIGHT=colors.HexColor('#E1F5EE'); LINE=colors.HexColor('#D8D6CF'); BG=colors.HexColor('#F4F2ED')
styles={
 'body':ParagraphStyle('body',fontName='Body',fontSize=9,leading=13,textColor=INK,spaceAfter=7),
 'small':ParagraphStyle('small',fontName='Body',fontSize=8,leading=11,textColor=MUTED,spaceAfter=5),
 'title':ParagraphStyle('title',fontName='Title',fontSize=23,leading=27,textColor=GREEN,spaceAfter=10),
 'head':ParagraphStyle('head',fontName='Bold',fontSize=12,leading=16,textColor=GREEN,spaceBefore=8,spaceAfter=6),
 'cell':ParagraphStyle('cell',fontName='Body',fontSize=8.5,leading=12,textColor=INK),
 'bold':ParagraphStyle('bold',fontName='Bold',fontSize=8.5,leading=12,textColor=INK),
}
def registered(v): return re.sub(r'\bCBE(?!®)', 'CBE®', str(v))
def safe(v): return escape(registered(v)).replace('\n','<br/>')
def p(v,style='body'): return Paragraph(safe(v),styles[style])
def money(v): return 'N/A' if v is None else ('-' if v<0 else '')+'${:,.0f}'.format(abs(v))
def pct(v): return 'N/A' if v is None else f'{v:g}%'
def ret(v): return 'Infinite' if v is None else ('N/A (negative cashflow)' if v=='neg' else pct(v))
def table(rows,widths=None,header=True):
    data=[[p(cell,'bold' if header and ix==0 else 'cell') for cell in row] for ix,row in enumerate(rows)]
    t=Table(data,colWidths=widths or [258,258],repeatRows=1 if header else 0,hAlign='LEFT')
    commands=[('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),9),('RIGHTPADDING',(0,0),(-1,-1),9),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4),('LINEBELOW',(0,0),(-1,-1),.4,LINE)]
    if header: commands += [('BACKGROUND',(0,0),(-1,0),LIGHT)]
    t.setStyle(TableStyle(commands));return t

def render(data):
    i=data['inputs'];r=data['results'];recipient=str(data['preparedFor']).strip()[:120]
    date=data.get('reportDate',''); wt=r['wholetail'];rt=r['retail'];ass=r['assignment'];bh=r['buyHold'];a=bh['ltv80'];b=bh['ltv75']
    profile=data['advisor']; title='Peter Calculator'; advisor='Peter Diamond, CBE®'
    logo=ImageReader(str(ROOT/'public/peter-banner.png'))
    bank=ImageReader(str(ROOT/'public/bankability-wide.png'))
    footer_logo=ImageReader(str(ROOT/'public/bankability.png'))
    buff=io.BytesIO()
    doc=SimpleDocTemplate(buff,pagesize=(612,792),leftMargin=48,rightMargin=48,topMargin=238,bottomMargin=54,title=title+' - '+recipient,author=advisor)
    def frame(c,d):
        c.saveState()
        # A large sideways logo beneath the content, deliberately low contrast.
        c.saveState();c.setFillAlpha(.075);c.translate(306,365);c.rotate(45)
        watermark_width=510;watermark_height=watermark_width*bank.getSize()[1]/bank.getSize()[0]
        c.drawImage(bank,-watermark_width/2,-watermark_height/2,width=watermark_width,height=watermark_height,mask='auto')
        c.restoreState()
        c.drawImage(bank,448,751,width=128,height=128*bank.getSize()[1]/bank.getSize()[0],mask='auto',preserveAspectRatio=True)
        c.drawImage(bank,36,751,width=128,height=128*bank.getSize()[1]/bank.getSize()[0],mask='auto',preserveAspectRatio=True)
        c.setFillColor(GREEN);c.setFont('Bold',9);c.drawCentredString(306,748,'EXCLUSIVELY PREPARED FOR')
        name_style=ParagraphStyle('recipient',parent=styles['title'],fontName='Bold',fontSize=28,leading=32,alignment=1)
        name=Paragraph(safe(recipient),name_style);nw,nh=name.wrap(440,40)
        while nh>38 and name_style.fontSize>12:
            name_style.fontSize-=1;name_style.leading=name_style.fontSize+3
            name=Paragraph(safe(recipient),name_style);nw,nh=name.wrap(440,40)
        name.drawOn(c,86,738-nh)
        c.setFillColor(MUTED);c.setFont('Bold',8);c.drawCentredString(306,688,'BY')
        advisor_size=17
        while pdfmetrics.stringWidth(advisor,'Bold',advisor_size)>480 and advisor_size>10:advisor_size-=1
        c.setFillColor(INK);c.setFont('Bold',advisor_size);c.drawCentredString(306,666,advisor)
        c.drawImage(logo,126,566,width=360,height=90,mask='auto')
        c.setFillColor(GREEN);c.setFont('Bold',8)
        c.drawString(126,553,'peterdiamond.tax')
        c.linkURL('https://peterdiamond.tax',(126,550,206,563),relative=0)
        c.drawRightString(486,553,'aibe.org')
        c.linkURL('https://aibe.org',(446,550,486,563),relative=0)
        c.setFillColor(MUTED);c.setFont('Body',7.5);c.drawCentredString(306,553,date)
        c.setStrokeColor(LINE);c.line(48,546,564,546)
        c.line(48,46,564,46);c.drawImage(footer_logo,48,20,width=20,height=20,mask='auto')
        c.setFont('Body',7);c.setFillColor(MUTED);c.drawString(76,32,'Bankability® | Build. Structure. Control.');c.drawString(76,21,'Illustrative estimates. Review assumptions with your CBE®.')
        c.drawRightString(564,27,f'{d.page}');c.restoreState()
    story=[]
    def add(text,style='body'): story.append(p(text,style))
    def section(text): add(text,'head')
    def page(text): story.append(PageBreak());add(text,'title')
    add('Your Deal at a Glance','title')
    add(i.get('address') or 'Property address not provided','head')
    add(f"Bankability Score®: {r['grade']}  |  Recommended path: {r['recommendation']['strategy']}",'head')
    add(r['recommendation']['reason'])
    story.append(table([['Deal summary','Amount'],['Total project cost',money(r['totalProjectCost'])],['After-repair value',money(i['arv'])],['Equity spread',money(r['equitySpread'])]], [330,186]))
    section('Exit comparison')
    story.append(table([['Strategy','Net after tax / cashflow'],['Wholetail (high / low)',money(wt['high']['netAfterTax'])+' / '+money(wt['low']['netAfterTax'])],['Retail sale',money(rt['netAfterTax'])],['Assignment (high / low)',money(ass['high']['netAfterTax'])+' / '+money(ass['low']['netAfterTax'])],['Buy & hold, 80% LTV',money(a['monthlySpread'])+'/month']], [258,258]))
    section('Inputs used in this report')
    add(f"Purchase {money(i['purchasePrice'])} · Rehab {money(i['rehabCost'])} · Holding {money(i['holdingCost'])} · Hold time {i['holdMonths']:g} months · Rent {money(i['monthlyRent'])}/month",'small')
    add(f"Wholetail price {money(i['wholetailPriceInput'])} · Assignment price {money(i['assignmentPriceInput'])} · DSCR assumption {i['dscrRate']:g}% · Op-ex reserve {i['expenseReservePct']:g}%",'small')
    page('Sale & Assignment Scenarios')
    section('Wholetail sale')
    rows=[['Measure','High','Conservative']]
    for label,key in [('Sale price','salePrice'),('Pre-tax profit','preTax'),('Net after-tax profit','netAfterTax')]: rows.append([label,money(wt['high'].get(key)),money(wt['low'].get(key))])
    story.append(table(rows,[236,140,140]))
    duration='N/A' if wt['holdMonths'] is None else f"{wt['holdMonths']:g} {'month' if wt['holdMonths']==1 else 'months'}"
    add(f"Hold time: {duration}. Selling cost: {wt['sellingPct']:g}%. Junkout: {money(wt['junkoutCost'])} ({wt['junkoutPct']:g}% of full rehab). Cost basis: {money(wt['costBasis'])}.",'small')
    section('Retail sale')
    story.append(table([['Measure','Amount'],['Sale price',money(rt['price'])],['Selling costs',money(rt['sellingCosts'])],['Pre-tax profit',money(rt['preTax'])],['Net after-tax profit',money(rt['netAfterTax'])],['Cash-on-cash / annualized return',pct(rt['coc'])+' / '+pct(rt['annualizedPct'])]],[330,186]))
    section('Assignment')
    story.append(table([['Measure','High','Conservative'],['Buyer price',money(ass['high']['buyerPrice']),money(ass['low']['buyerPrice'])],['Assignment fee',money(ass['high']['fee']),money(ass['low']['fee'])],['Net after-tax profit',money(ass['high']['netAfterTax']),money(ass['low']['netAfterTax'])]],[236,140,140]))
    add(f"Marketing cost: {money(ass['marketingCost'])}. Estimated closing time: {ass['holdWeeks']:g} weeks. The conservative scenarios reduce the markup or fee by 20%, not the full sale price.",'small')
    page('Buy & Hold / Wealth Analysis')
    add('Financing, cashflow, and first-year wealth metrics use the same assumptions and calculated results as the on-screen analysis.','small')
    rows=[['Measure','80% LTV','75% LTV']]
    for label,key,fmt in [('Loan amount','loanAmount',money),('Cash left in deal','cashLeft',money),('Excess refi proceeds','excessProceeds',money),('Equity in property','equity',money),('Operating reserve / month','opexReserve',money),('Loan principal & interest / month','monthlyPI',money),('Cashflow / month','monthlySpread',money),('Cashflow / year','annualCF',money),('DSCR (rent / principal & interest)','dscrRatio',lambda v:'N/A' if v is None else str(v)+'x'),('Cash-on-cash return','coc',ret),('Year 1 principal paydown','principalYr1',money),('Total annual benefit','totalAnnualBenefit',money),('Total blended return','totalReturn',ret)]:
        rows.append([label,fmt(a.get(key)),fmt(b.get(key))])
    story.append(table(rows,[248,134,134]))
    section('Depreciation & tax shield')
    add(f"Depreciable basis: {money(bh['deprBasis'])} · Annual depreciation: {money(bh['annualDepr'])} · Annual tax shield: {money(bh['annualTaxShield'])}.")
    add('DSCR shown uses rent / principal and interest. Lenders may include taxes and insurance. Cashflow and tax results are estimates; confirm actual financing and operating expenses with your CBE.','small')
    page('Long-Term Outlook & Assumptions')
    section('80% LTV projection')
    add('Conservative 3.1% annual appreciation; year 1 starts at the entered ARV. Projections include the original calculator’s loan amortization, rent growth, and tax assumptions.','small')
    rows=[['Year','Property value','Loan balance','Equity','Cumulative wealth gain']]
    for proj in a['projections']: rows.append([str(proj['yr']),money(proj['propVal']),money(proj['loanBal']),money(proj['projEq']),money(proj['cumTotal'])])
    story.append(table(rows,[40,119,119,119,119]))
    section('Refinance strategy')
    dw=bh['dwrs'];add(f"80% ARV loan: {money(dw['loanAmount'])}. Net cash at close: {money(dw['netAtClose'])}. Estimated monthly cashflow: {money(dw['monthlySpread'])}.")
    add('Cumulative wealth gain combines appreciation, principal reduction, cashflow, and the tax shield. It is a projection, not a guaranteed return.','small')
    section('Assumptions to review with Peter')
    add(f"Property type: {'Condo / no land' if i.get('propertyType')=='condo' else 'Single family home'}. State: {i.get('stateCode','Not specified')}. DSCR interest assumption: {i['dscrRate']:g}%. Operating reserve: {i['expenseReservePct']:g}% of rent. Wholetail selling cost: {i['wholetailSellingPct']:g}%. Wholetail timing: {i['wholetailHoldPct']:g}% of the full rehab hold time.")
    section('Important notes')
    add('Pencil Your Deal™ is an educational planning tool. It does not guarantee loan approval, sale price, rental income, or investment performance. Tax figures are simplified estimates; consult a qualified tax professional. Validate local comparables, property condition, financing, taxes, insurance, and closing costs before acting.','small')
    add('This PDF summarizes the analyzed deal. The interactive calculator includes additional dashboards, amortization schedules, and portfolio tools.','small')
    add('Pencil Your Deal™ · The Best System in the Game® · Keep the Best, Wholesale the Rest™','small')
    doc.build(story,onFirstPage=frame,onLaterPages=frame)
    return buff.getvalue()

if __name__=='__main__':
    payload=json.load(sys.stdin)
    sys.stdout.buffer.write(render(payload))
