//! Benchmarks do núcleo (criterion): parse dos eventos de cada harness, listagem do tmux e da árvore
//! de processos, agregação (transcript/uso e recursos) e diff. `cargo bench --profile perf -p kabul-core`.
use criterion::{black_box, criterion_group, criterion_main, BatchSize, Criterion, Throughput};
use kabul_core::harness::{Event, HarnessKind, SessionOptions};
use kabul_core::resources::{self, Proc};
use kabul_core::transcript::Transcript;
use kabul_core::{agent, gitops, store, tmux};

fn parse_all(kind: HarnessKind, fx: &str, opts: &SessionOptions) -> usize {
    let mut p = kind.harness().protocol(opts);
    let mut n = p.startup().len();
    for l in fx.lines() {
        let (e, o) = p.on_line(l);
        n += e.len() + o.len();
    }
    n
}

fn harnesses(c: &mut Criterion) {
    let opts = SessionOptions { cwd: Some("/tmp".into()), ..Default::default() };
    let mut g = c.benchmark_group("harness_parse");
    let cases: &[(&str, HarnessKind, &str)] = &[
        ("claude", HarnessKind::Claude, include_str!("../tests/fixtures/claude_stream.ndjson")),
        ("codex_app_server", HarnessKind::Codex, include_str!("../tests/fixtures/codex_app_server.ndjson")),
        ("antigravity", HarnessKind::Antigravity, include_str!("../tests/fixtures/agy_tools.ndjson")),
        ("opencode", HarnessKind::OpenCode, include_str!("../tests/fixtures/opencode_run.ndjson")),
        ("acp_goose", HarnessKind::Goose, include_str!("../tests/fixtures/acp_opencode.ndjson")),
        ("acp_gemini", HarnessKind::GeminiCli, include_str!("../tests/fixtures/acp_opencode.ndjson")),
        ("acp_qwen", HarnessKind::QwenCode, include_str!("../tests/fixtures/acp_opencode.ndjson")),
    ];
    for (name, kind, fx) in cases {
        g.throughput(Throughput::Bytes(fx.len() as u64));
        g.bench_function(*name, |b| b.iter(|| parse_all(*kind, black_box(fx), &opts)));
    }
    // Caminho quente de verdade: 1.000 deltas de texto do Claude em streaming.
    let deltas: String = (0..1000).map(|i| format!("{{\"type\":\"stream_event\",\"event\":{{\"type\":\"content_block_delta\",\"index\":0,\"delta\":{{\"type\":\"text_delta\",\"text\":\"palavra {i} \"}}}},\"session_id\":\"s\"}}\n")).collect();
    g.throughput(Throughput::Elements(1000));
    g.bench_function("claude_1000_deltas", |b| b.iter(|| parse_all(HarnessKind::Claude, black_box(&deltas), &opts)));
    g.finish();
}

fn panes_text(n: usize) -> String {
    (0..n).map(|i| format!("kabul-ws-{i}\t0\tzsh\t0\t%{i}\t{}\tclaude\t/Users/dev/kabul/workspaces/app/ws-{i}\t1\ttitulo {i}\n", 10_000 + i)).collect()
}

/// `ps -A -o pid=,ppid=,command=` sintético: `roots` panes, cada um com uma árvore de agente, e ruído.
fn ps_text(total: usize, roots: usize) -> String {
    let mut s = String::new();
    for i in 0..total {
        let pid = 10_000 + i;
        let ppid = if i < roots {
            1
        } else if i < roots * 6 {
            10_000 + (i % roots)
        } else {
            1 + (i % 500)
        };
        let cmd = if i < roots {
            "-zsh".to_string()
        } else if i < roots * 2 {
            "node /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js".into()
        } else {
            format!("/usr/libexec/servico-{i} --flag")
        };
        s.push_str(&format!("{pid:>6} {ppid:>6} {cmd}\n"));
    }
    s
}

fn listing(c: &mut Criterion) {
    let mut g = c.benchmark_group("listagem");
    let panes = panes_text(500);
    g.bench_function("tmux_parse_500_panes", |b| b.iter(|| tmux::parse_list_panes(black_box(&panes)).len()));
    let ps = ps_text(2000, 30);
    g.bench_function("descendentes_30_panes_de_2000_procs", |b| b.iter(|| (0..30u32).map(|r| agent::descendants_from_ps(black_box(&ps), 10_000 + r).len()).sum::<usize>()));
    g.bench_function("descendentes_indexado_30_panes_de_2000_procs", |b| {
        b.iter(|| {
            let idx = agent::ProcIndex::parse(black_box(&ps));
            (0..30u32).map(|r| idx.descendants(10_000 + r).len()).sum::<usize>()
        })
    });
    let screen: String = (0..64).map(|i| format!("\x1b[38;5;{i}mlinha {i} com cor\x1b[0m e texto comum para o status\n")).collect::<String>().repeat(16);
    g.throughput(Throughput::Bytes(screen.len() as u64));
    g.bench_function("strip_ansi_tela", |b| b.iter(|| kabul_core::harness::strip_ansi(black_box(&screen)).len()));
    g.finish();
}

fn procs(n: usize) -> Vec<Proc> {
    (0..n as u32)
        .map(|i| Proc {
            pid: 100 + i,
            parent: Some(if i == 0 {
                1
            } else if i < 60 {
                100
            } else {
                100 + (i % 60)
            }),
            name: if i % 7 == 0 {
                "claude".into()
            } else if i % 5 == 0 {
                "zsh".into()
            } else {
                format!("proc-{i}")
            },
            cmd: vec![format!("proc-{i}")],
            cpu: (i % 13) as f32,
            mem: 1024 * (i as u64 % 97),
            cwd: Some(format!("/w/ws-{}/src", i % 100)),
            start: 0,
        })
        .collect()
}

fn aggregation(c: &mut Criterion) {
    let mut g = c.benchmark_group("agregacao");
    let ps = procs(2000);
    let hints: Vec<resources::Hint> = (0..100).map(|i| resources::Hint { pid: None, path: Some(format!("/w/ws-{i}")), workspace_id: format!("w{i}"), chat_id: None }).collect();
    g.bench_function("recursos_arvore_2000_procs_100_ws", |b| b.iter(|| resources::build(black_box(&ps), 100, &hints).count));

    // Transcript de uma conversa longa: 200 turnos com texto em streaming, ferramentas e uso.
    let mut evs = vec![Event::SessionStarted { session_id: "s".into(), model: Some("m".into()) }];
    for t in 0..200 {
        for k in 0..40 {
            evs.push(Event::TextDelta { text: format!("palavra {k} ") });
        }
        evs.push(Event::ToolUse { id: format!("t{t}"), name: "Bash".into(), input: serde_json::json!({"command": "ls"}) });
        evs.push(Event::ToolResult { id: format!("t{t}"), output: "a\nb".into(), is_error: false });
        evs.push(Event::Usage { input: Some(10), output: Some(20), cache_read: Some(5), cache_write: None, duration_ms: Some(900) });
        evs.push(Event::TurnCompleted { result: None, input_tokens: Some(10), output_tokens: Some(20), cost_usd: Some(0.01) });
    }
    g.throughput(Throughput::Elements(evs.len() as u64));
    g.bench_function("transcript_uso_8800_eventos", |b| {
        b.iter_batched(
            || {
                let mut t = Transcript::default();
                t.start_segment(HarnessKind::Claude, "opus", None);
                t
            },
            |mut t| {
                for e in &evs {
                    t.apply(e);
                }
                t.entries.len()
            },
            BatchSize::SmallInput,
        )
    });
    g.finish();
}

fn diff(c: &mut Criterion) {
    let mut g = c.benchmark_group("diff");
    let numstat: String = (0..5000).map(|i| format!("{}\t{}\tsrc/modulo_{i}/arquivo_{i}.rs\n", i % 50, i % 30)).collect();
    g.bench_function("numstat_5000_arquivos", |b| b.iter(|| store::parse_numstat(black_box(&numstat)).len()));
    let grep: String = (0..5000).map(|i| format!("src/a_{i}.rs:{i}:    let x = busca({i});\n")).collect();
    g.bench_function("grep_5000_linhas", |b| b.iter(|| gitops::parse_grep(black_box(&grep), 500).len()));
    g.finish();
}

criterion_group! {
    name = benches;
    config = Criterion::default().sample_size(30).warm_up_time(std::time::Duration::from_millis(500)).measurement_time(std::time::Duration::from_secs(2));
    targets = harnesses, listing, aggregation, diff
}
criterion_main!(benches);
