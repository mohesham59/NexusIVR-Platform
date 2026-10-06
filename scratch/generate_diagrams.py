import os
import matplotlib.pyplot as plt
import matplotlib.patches as patches

os.makedirs('scratch/generated_diagrams', exist_ok=True)
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'

def create_figure_4_2():
    """Figure 4.2 — System Architecture: Control Plane vs. Data Plane (with RAG Subsystem)"""
    fig, ax = plt.subplots(figsize=(12, 4.5), dpi=300)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 4.5)
    ax.axis('off')

    # Title
    ax.text(6, 4.25, "System Architecture: Control Plane vs. Data Plane (with RAG Subsystem)", 
            ha='center', va='center', fontsize=13, fontweight='bold', color='#0F172A')

    # Control Plane Box (Left)
    rect_cp = patches.FancyBboxPatch((0.4, 0.4), 6.8, 3.4, boxstyle="round,pad=0.08", ec="#2563EB", fc="#EFF6FF", lw=2)
    ax.add_patch(rect_cp)
    ax.text(0.6, 3.5, "CONTROL PLANE (Management & AI Engine)", fontsize=10.5, fontweight='bold', color='#1E40AF')

    # Components inside Control Plane
    box_webapp = patches.FancyBboxPatch((0.7, 2.3), 1.8, 0.9, boxstyle="round,pad=0.05", ec="#3B82F6", fc="#FFFFFF", lw=1.5)
    ax.add_patch(box_webapp)
    ax.text(1.6, 2.75, "IVR-webapp\n(React 19)", ha='center', va='center', fontsize=8.5, fontweight='bold', color='#1E293B')

    box_ai = patches.FancyBboxPatch((2.9, 2.3), 2.0, 0.9, boxstyle="round,pad=0.05", ec="#3B82F6", fc="#FFFFFF", lw=1.5)
    ax.add_patch(box_ai)
    ax.text(3.9, 2.75, "IVR-AI-engine\n(Java 21 / Servlet)", ha='center', va='center', fontsize=8.5, fontweight='bold', color='#1E293B')

    # RAG Microservice Box
    box_rag = patches.FancyBboxPatch((2.9, 0.7), 2.0, 1.1, boxstyle="round,pad=0.05", ec="#7C3AED", fc="#F5F3FF", lw=2)
    ax.add_patch(box_rag)
    ax.text(3.9, 1.25, "RAG Microservice\n(Python / FastAPI)\n[Port 8000]", ha='center', va='center', fontsize=8.5, fontweight='bold', color='#5B21B6')

    # DB Box
    box_db = patches.FancyBboxPatch((5.2, 0.7), 1.8, 2.5, boxstyle="round,pad=0.05", ec="#059669", fc="#ECFDF5", lw=1.5)
    ax.add_patch(box_db)
    ax.text(6.1, 1.95, "PostgreSQL 15\n\n- Relational DB\n- pgvector HNSW\n- knowledge_docs\n- embeddings", ha='center', va='center', fontsize=8, fontweight='bold', color='#065F46')

    # Payment Service
    box_pay = patches.FancyBboxPatch((0.7, 0.7), 1.8, 0.9, boxstyle="round,pad=0.05", ec="#3B82F6", fc="#FFFFFF", lw=1.5)
    ax.add_patch(box_pay)
    ax.text(1.6, 1.15, "Payment Service\n(Paymob)", ha='center', va='center', fontsize=8.5, fontweight='bold', color='#1E293B')

    # Data Plane Box (Right)
    rect_dp = patches.FancyBboxPatch((7.6, 0.4), 4.0, 3.4, boxstyle="round,pad=0.08", ec="#D97706", fc="#FFFBEB", lw=2)
    ax.add_patch(rect_dp)
    ax.text(7.8, 3.5, "DATA PLANE (Telephony Execution)", fontsize=10.5, fontweight='bold', color='#92400E')

    box_agi = patches.FancyBboxPatch((7.9, 2.1), 3.4, 1.1, boxstyle="round,pad=0.05", ec="#F59E0B", fc="#FFFFFF", lw=1.5)
    ax.add_patch(box_agi)
    ax.text(9.6, 2.65, "IVR-engine (FastAGI Daemon)\nVoiceXML DOM Interpreter", ha='center', va='center', fontsize=8.5, fontweight='bold', color='#1E293B')

    box_ast = patches.FancyBboxPatch((7.9, 0.7), 3.4, 1.1, boxstyle="round,pad=0.05", ec="#F59E0B", fc="#FFFFFF", lw=1.5)
    ax.add_patch(box_ast)
    ax.text(9.6, 1.25, "Asterisk 20 PBX\nSIP / PJSIP & Audio Pipeline", ha='center', va='center', fontsize=8.5, fontweight='bold', color='#1E293B')

    # Connectors
    ax.annotate('', xy=(2.9, 2.75), xytext=(2.5, 2.75), arrowprops=dict(arrowstyle="->", color="#2563EB", lw=1.5))
    ax.annotate('', xy=(3.9, 1.8), xytext=(3.9, 2.3), arrowprops=dict(arrowstyle="<->", color="#7C3AED", lw=1.5))
    ax.annotate('', xy=(5.2, 1.25), xytext=(4.9, 1.25), arrowprops=dict(arrowstyle="<->", color="#059669", lw=1.5))
    ax.annotate('', xy=(5.2, 2.75), xytext=(4.9, 2.75), arrowprops=dict(arrowstyle="->", color="#2563EB", lw=1.5))
    ax.annotate('', xy=(7.9, 2.65), xytext=(4.9, 2.75), arrowprops=dict(arrowstyle="->", color="#DC2626", lw=1.5, ls="--"))
    ax.annotate('', xy=(9.6, 2.1), xytext=(9.6, 1.8), arrowprops=dict(arrowstyle="<->", color="#D97706", lw=1.5))

    path = 'scratch/generated_diagrams/fig_4_2_system_architecture.png'
    plt.savefig(path, bbox_inches='tight', dpi=300)
    plt.close()
    print('Generated:', path)

def create_figure_6_1():
    """Figure 6.1 — The 7-Pass Unified AI Pipeline (with RAG Vector Context Step)"""
    fig, ax = plt.subplots(figsize=(11.6, 9.6), dpi=300)
    ax.set_xlim(0, 11.6)
    ax.set_ylim(0, 9.6)
    ax.axis('off')

    ax.text(5.8, 9.2, "The 7-Pass Unified AI Pipeline (with RAG Vector Search)", 
            ha='center', va='center', fontsize=13, fontweight='bold', color='#0F172A')

    passes = [
        ("Pass 1: Prompt Refinement", "Extract intent, domain & specs via LLM", "#2563EB", "#EFF6FF"),
        ("[RAG Step] Knowledge Base Search", "Query pgvector HNSW index & inject document context", "#7C3AED", "#F5F3FF"),
        ("Pass 2: Specification Expansion", "Expand missing departments, DTMF menus & flows", "#2563EB", "#EFF6FF"),
        ("Pass 3: VoiceXML Synthesis", "Generate raw VoiceXML 2.1 via LLM / ProviderManager", "#0284C7", "#E0F2FE"),
        ("Pass 4: Response Normalization", "Strip BOM, unescape JSON & extract XML code fences", "#D97706", "#FEF3C7"),
        ("Pass 5: Structural Validation", "Evaluate 9 graph rules & compute flow quality score", "#DC2626", "#FEE2E2"),
        ("Pass 6: Auto-Repair Engine", "Fix orphan nodes, invalid ports & transfer extensions", "#059669", "#ECFDF5"),
        ("Pass 7: Export & Canvas Render", "Serialize canonical VoiceXML & compute React Flow layout", "#16A34A", "#F0FDF4")
    ]

    y = 8.3
    for i, (title, desc, border_c, bg_c) in enumerate(passes):
        is_rag = "[RAG Step]" in title
        lw = 2.5 if is_rag else 1.5
        box = patches.FancyBboxPatch((1.8, y - 0.75), 8.0, 0.75, boxstyle="round,pad=0.06", ec=border_c, fc=bg_c, lw=lw)
        ax.add_patch(box)
        
        ax.text(2.1, y - 0.28, title, fontsize=10, fontweight='bold', color=border_c)
        ax.text(2.1, y - 0.55, desc, fontsize=8.5, color='#334155')

        if i < len(passes) - 1:
            ax.annotate('', xy=(5.8, y - 0.9), xytext=(5.8, y - 0.75),
                        arrowprops=dict(arrowstyle="->", color=border_c, lw=1.5))
        y -= 1.02

    path = 'scratch/generated_diagrams/fig_6_1_7pass_pipeline.png'
    plt.savefig(path, bbox_inches='tight', dpi=300)
    plt.close()
    print('Generated:', path)

def create_figure_11_1():
    """Figure 11.1 — Core Database Tables & RAG Schema (ERD)"""
    fig, ax = plt.subplots(figsize=(11.6, 6.0), dpi=300)
    ax.set_xlim(0, 11.6)
    ax.set_ylim(0, 6.0)
    ax.axis('off')

    ax.text(5.8, 5.65, "Core Database Tables & RAG Vector Schema (ERD)", 
            ha='center', va='center', fontsize=13, fontweight='bold', color='#0F172A')

    tables = [
        ("tenants", ["id (PK)", "name", "slug", "status"], 0.6, 3.2, "#2563EB", "#EFF6FF"),
        ("users", ["id (PK)", "tenant_id (FK)", "email", "role"], 3.0, 3.2, "#2563EB", "#EFF6FF"),
        ("ivr_flows", ["id (PK)", "tenant_id (FK)", "name", "status"], 5.4, 3.2, "#2563EB", "#EFF6FF"),
        ("ai_sessions", ["id (PK)", "tenant_id (FK)", "channel"], 7.8, 3.2, "#2563EB", "#EFF6FF"),
        ("messages", ["id (PK)", "session_id (FK)", "role", "content"], 9.6, 3.2, "#2563EB", "#EFF6FF"),
        
        # RAG Tables (Highlighted)
        ("knowledge_docs (RAG)", ["doc_id (PK)", "tenant_id (FK)", "filename", "file_type", "status", "created_at"], 2.4, 0.6, "#7C3AED", "#F5F3FF"),
        ("knowledge_embeddings (RAG)", ["embedding_id (PK)", "doc_id (FK)", "tenant_id (FK)", "chunk_content", "embedding vector(1536)", "idx_embeddings_vector_hnsw"], 6.2, 0.6, "#7C3AED", "#F5F3FF")
    ]

    for name, cols, x, y, border_c, bg_c in tables:
        is_rag = "RAG" in name
        w = 3.2 if is_rag and "embeddings" in name else (2.4 if is_rag else 1.6)
        h = 2.1 if is_rag else 1.9
        
        box = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.05", ec=border_c, fc=bg_c, lw=2 if is_rag else 1.5)
        ax.add_patch(box)
        
        # Header bar
        header_box = patches.Rectangle((x, y + h - 0.45), w, 0.45, ec=border_c, fc=border_c)
        ax.add_patch(header_box)
        ax.text(x + w/2, y + h - 0.22, name, ha='center', va='center', fontsize=9, fontweight='bold', color='#FFFFFF')

        # Columns
        col_y = y + h - 0.7
        for col in cols:
            fontw = 'bold' if 'PK' in col or 'FK' in col or 'vector' in col else 'normal'
            color = '#6D28D9' if 'vector' in col or 'hnsw' in col else '#334155'
            ax.text(x + 0.1, col_y, f"• {col}", fontsize=7.5, fontweight=fontw, color=color)
            col_y -= 0.25

    # Connections
    ax.annotate('', xy=(2.4, 1.6), xytext=(1.4, 3.2), arrowprops=dict(arrowstyle="->", color="#7C3AED", lw=1.5, ls="--"))
    ax.annotate('', xy=(6.2, 1.6), xytext=(4.8, 1.6), arrowprops=dict(arrowstyle="->", color="#7C3AED", lw=1.5))
    ax.annotate('', xy=(7.8, 2.7), xytext=(7.0, 3.2), arrowprops=dict(arrowstyle="->", color="#2563EB", lw=1.2))

    path = 'scratch/generated_diagrams/fig_11_1_erd.png'
    plt.savefig(path, bbox_inches='tight', dpi=300)
    plt.close()
    print('Generated:', path)

def create_figure_12_1():
    """Figure 12.1 — Multi-Tenant Isolation: Three-Layer Defense (including RAG)"""
    fig, ax = plt.subplots(figsize=(12, 3.2), dpi=300)
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 3.2)
    ax.axis('off')

    ax.text(6, 2.9, "Multi-Tenant Isolation Architecture (Three-Layer Defense)", 
            ha='center', va='center', fontsize=12.5, fontweight='bold', color='#0F172A')

    layers = [
        ("Layer 1: Schema Level", "Every table includes tenant_id UUID.\n`knowledge_docs` & `knowledge_embeddings` FK to tenants.id", "#2563EB", "#EFF6FF", 0.5),
        ("Layer 2: Application Level", "BaseAiServlet extracts JWT tenant_id.\n`RagClient` injects mandatory tenant_id filter into vector search queries.", "#7C3AED", "#F5F3FF", 4.3),
        ("Layer 3: Database RLS", "PostgreSQL Row-Level Security (RLS)\nRestricts vector distance search (<=>) to authenticated tenant_id.", "#059669", "#ECFDF5", 8.1)
    ]

    for title, desc, border_c, bg_c, x in layers:
        box = patches.FancyBboxPatch((x, 0.4), 3.4, 2.1, boxstyle="round,pad=0.08", ec=border_c, fc=bg_c, lw=2)
        ax.add_patch(box)
        
        ax.text(x + 1.7, 2.1, title, ha='center', va='center', fontsize=9.5, fontweight='bold', color=border_c)
        ax.text(x + 0.2, 1.2, desc, fontsize=8, color='#334155', va='center')

    ax.annotate('', xy=(4.3, 1.45), xytext=(3.9, 1.45), arrowprops=dict(arrowstyle="->", color="#2563EB", lw=2))
    ax.annotate('', xy=(8.1, 1.45), xytext=(7.7, 1.45), arrowprops=dict(arrowstyle="->", color="#7C3AED", lw=2))

    path = 'scratch/generated_diagrams/fig_12_1_multitenant.png'
    plt.savefig(path, bbox_inches='tight', dpi=300)
    plt.close()
    print('Generated:', path)

def create_figure_startup():
    """Container Startup Dependency Order (with RAG Microservice)"""
    fig, ax = plt.subplots(figsize=(11.6, 5.8), dpi=300)
    ax.set_xlim(0, 11.6)
    ax.set_ylim(0, 5.8)
    ax.axis('off')

    ax.text(5.8, 5.4, "Docker Container Startup Dependency Order (with RAG Service)", 
            ha='center', va='center', fontsize=12.5, fontweight='bold', color='#0F172A')

    containers = [
        ("Step 1: postgres", "PostgreSQL 15 + pgvector", 0.6, 2.2, "#059669", "#ECFDF5"),
        ("Step 2a: rag-service", "Python Vector Search\n[Port 8000]", 3.2, 3.6, "#7C3AED", "#F5F3FF"),
        ("Step 2b: ai-engine", "Java AI Backend\n[Port 8081]", 3.2, 2.0, "#2563EB", "#EFF6FF"),
        ("Step 2c: payment-service", "Payment Backend\n[Port 8082]", 3.2, 0.5, "#2563EB", "#EFF6FF"),
        ("Step 3: ivr-engine", "FastAGI Telephony\n[Port 4573]", 6.4, 2.0, "#D97706", "#FFFBEB"),
        ("Step 4: webapp", "React Frontend\n[Port 3000]", 9.0, 2.0, "#2563EB", "#EFF6FF")
    ]

    for name, desc, x, y, border_c, bg_c in containers:
        is_rag = "rag" in name
        box = patches.FancyBboxPatch((x, y), 2.1, 1.2, boxstyle="round,pad=0.06", ec=border_c, fc=bg_c, lw=2 if is_rag else 1.5)
        ax.add_patch(box)
        
        ax.text(x + 1.05, y + 0.85, name, ha='center', va='center', fontsize=8.5, fontweight='bold', color=border_c)
        ax.text(x + 1.05, y + 0.4, desc, ha='center', va='center', fontsize=7.5, color='#334155')

    # Arrows from postgres
    ax.annotate('', xy=(3.2, 4.2), xytext=(2.7, 2.8), arrowprops=dict(arrowstyle="->", color="#059669", lw=1.5))
    ax.annotate('', xy=(3.2, 2.6), xytext=(2.7, 2.8), arrowprops=dict(arrowstyle="->", color="#059669", lw=1.5))
    ax.annotate('', xy=(3.2, 1.1), xytext=(2.7, 2.8), arrowprops=dict(arrowstyle="->", color="#059669", lw=1.5))

    # Arrow from rag-service & postgres to ai-engine
    ax.annotate('', xy=(4.25, 3.2), xytext=(4.25, 3.6), arrowprops=dict(arrowstyle="->", color="#7C3AED", lw=1.5))

    # Arrows to ivr-engine
    ax.annotate('', xy=(6.4, 2.6), xytext=(5.3, 2.6), arrowprops=dict(arrowstyle="->", color="#2563EB", lw=1.5))

    # Arrows to webapp
    ax.annotate('', xy=(9.0, 2.6), xytext=(8.5, 2.6), arrowprops=dict(arrowstyle="->", color="#D97706", lw=1.5))

    path = 'scratch/generated_diagrams/fig_startup_containers.png'
    plt.savefig(path, bbox_inches='tight', dpi=300)
    plt.close()
    print('Generated:', path)

create_figure_4_2()
create_figure_6_1()
create_figure_11_1()
create_figure_12_1()
create_figure_startup()
