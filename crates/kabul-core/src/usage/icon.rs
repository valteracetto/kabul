//! Ícone da barra do Kabul desenhado em RGBA, sem depender de plataforma: de 1 a 3 barras horizontais
//! (os limites escolhidos, ou os dois mais apertados no automático) com trilho translúcido, ou só o
//! símbolo do Kabul. No macOS vai como "template" (só o alfa conta e o sistema pinta claro/escuro); no
//! Windows/Linux, com a cor dada.
//!
//! A escolha do que vai no ícone ([`select`]) e o texto ao lado ([`title_text`]) ficam aqui, testáveis
//! sem interface; o desktop só desenha e aplica.
use super::Limit;
use crate::settings::{PinnedLimit, TrayIconPrefs, TRAY_MAX_PINNED};

/// Tamanho do ícone (quadrado, em pixels).
pub const SIZE: u32 = 44;

/// Um limite que vai no ícone. `used_pct = None`: escolhido mas sem dado agora (só o trilho).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Slot {
    pub provider: String,
    pub account: String,
    pub account_label: Option<String>,
    pub window: String,
    pub title: String,
    pub used_pct: Option<f64>,
    pub resets_at: Option<u64>,
}

impl Slot {
    fn of(l: &Limit) -> Self {
        Self { provider: l.provider.clone(), account: l.account_key(), account_label: l.account_label.clone(), window: l.window.clone(), title: l.title.clone(), used_pct: Some(l.used_pct), resets_at: l.resets_at }
    }
}

fn by_pct_desc(a: &&Limit, b: &&Limit) -> std::cmp::Ordering {
    b.used_pct.partial_cmp(&a.used_pct).unwrap_or(std::cmp::Ordering::Equal)
}

/// O que vai no ícone. Automático (ou manual sem nada escolhido): os dois limites mais apertados que ainda
/// valem. Manual: os escolhidos, na ordem, até 3; um escolhido sem leitura agora entra vazio.
pub fn select(lims: &[Limit], prefs: &TrayIconPrefs, now: u64) -> Vec<Slot> {
    let live: Vec<&Limit> = lims.iter().filter(|l| l.live(now)).collect();
    if prefs.mode == "manual" && !prefs.pinned.is_empty() {
        return prefs
            .pinned
            .iter()
            .take(TRAY_MAX_PINNED)
            .map(|p| match live.iter().find(|l| matches(l, p)) {
                Some(l) => Slot::of(l),
                None => Slot { provider: p.provider.clone(), account: p.account.clone(), window: p.window.clone(), title: window_title(&p.window), ..Default::default() },
            })
            .collect();
    }
    let mut v = live;
    v.sort_by(by_pct_desc);
    v.into_iter().take(2).map(Slot::of).collect()
}

/// Título de uma janela só pelo id (limite escolhido que está sem leitura agora).
pub fn window_title(window: &str) -> String {
    let mins = match window {
        "5h" => Some(300),
        "semana" | "seven_day" => Some(10_080),
        "mes" => Some(43_200),
        _ => None,
    };
    if mins.is_some() {
        return super::limits::window_name(mins, window).1;
    }
    match window.strip_prefix("seven_day_") {
        Some(m) if !m.is_empty() => format!("Semana ({}{})", m[..1].to_uppercase(), &m[1..]),
        _ if window == "extra" => "Uso extra".into(),
        _ => window.to_string(),
    }
}

/// O limite é o escolhido? (mesmo provedor, conta e janela).
pub fn matches(l: &Limit, p: &PinnedLimit) -> bool {
    l.provider == p.provider && l.window == p.window && l.account_key() == p.account
}

/// Texto ao lado do ícone (macOS): as porcentagens (estilos `percent` e `bars_percent`) e o gasto de hoje
/// (já formatado por quem chama) quando ligado. `None` = sem texto.
pub fn title_text(slots: &[Slot], prefs: &TrayIconPrefs, spend: Option<&str>) -> Option<String> {
    let mut parts = vec![];
    if matches!(prefs.style.as_str(), "percent" | "bars_percent") && !slots.is_empty() {
        parts.push(slots.iter().map(|s| s.used_pct.map(|p| format!("{p:.0}%")).unwrap_or_else(|| "—".into())).collect::<Vec<_>>().join(" · "));
    }
    if prefs.show_spend {
        parts.extend(spend.map(String::from));
    }
    (!parts.is_empty()).then(|| parts.join("  "))
}

/// O estilo desenha barras? (`bars`, `bars_percent`; o resto usa o símbolo).
pub fn draws_bars(prefs: &TrayIconPrefs) -> bool {
    matches!(prefs.style.as_str(), "bars" | "bars_percent")
}

/// Desenha o ícone para os limites escolhidos e o estilo.
pub fn render_for(slots: &[Slot], prefs: &TrayIconPrefs, rgb: [u8; 3]) -> Vec<u8> {
    if draws_bars(prefs) {
        let pcts: Vec<Option<f64>> = if slots.is_empty() { vec![None, None] } else { slots.iter().map(|s| s.used_pct).collect() };
        render_bars(&pcts, rgb)
    } else {
        render_glyph(rgb)
    }
}

/// Uma barra arredondada de `x0` a `x1`, altura `h`, a partir de `y0`; `pct` preenche da esquerda.
fn bar(px: &mut [u8], y0: i32, h: i32, pct: Option<f64>, rgb: [u8; 3]) {
    let s = SIZE as i32;
    let (x0, x1, r) = (4, s - 4, h / 2);
    let fill = pct.map(|p| x0 + ((x1 - x0) as f64 * p.clamp(0.0, 100.0) / 100.0).round() as i32);
    for y in y0..y0 + h {
        for x in x0..x1 {
            // Cantos arredondados: fora do raio nos quatro cantos fica transparente.
            let edge = |v: i32, lo: i32, hi: i32| {
                if v < lo {
                    lo
                } else if v >= hi {
                    hi - 1
                } else {
                    v
                }
            };
            let (cx, cy) = (edge(x, x0 + r, x1 - r), edge(y, y0 + r, y0 + h - r));
            let (dx, dy) = ((x - cx) as f64, (y - cy) as f64);
            if dx * dx + dy * dy > (r as f64 + 0.25).powi(2) {
                continue;
            }
            let on = fill.is_some_and(|f| x < f.max(x0 + if pct.unwrap_or(0.0) > 0.0 { 2 } else { 0 }));
            let a = if on { 255 } else { 80 };
            let i = ((y * s + x) * 4) as usize;
            px[i..i + 4].copy_from_slice(&[rgb[0], rgb[1], rgb[2], a]);
        }
    }
}

/// De 1 a 3 barras (o resto é ignorado), centralizadas na altura. `None`: só o trilho.
pub fn render_bars(pcts: &[Option<f64>], rgb: [u8; 3]) -> Vec<u8> {
    let mut px = vec![0u8; (SIZE * SIZE * 4) as usize];
    let n = pcts.len().clamp(1, TRAY_MAX_PINNED);
    let (h, gap) = match n {
        1 => (14, 0),
        2 => (12, 6),
        _ => (10, 4),
    };
    let total = n as i32 * h + (n as i32 - 1) * gap;
    let top = (SIZE as i32 - total) / 2;
    for (i, p) in pcts.iter().chain(std::iter::repeat(&None)).take(n).enumerate() {
        bar(&mut px, top + i as i32 * (h + gap), h, *p, rgb);
    }
    px
}

/// Compatível com o desenho de antes: duas barras (em cima o mais apertado).
pub fn render(top: Option<f64>, bottom: Option<f64>, rgb: [u8; 3]) -> Vec<u8> {
    render_bars(&[top, bottom], rgb)
}

/// Só o símbolo: um medidor (arco de 3/4 de volta com o ponteiro), para o estilo "só ícone" e "porcentagem".
pub fn render_glyph(rgb: [u8; 3]) -> Vec<u8> {
    let s = SIZE as i32;
    let mut px = vec![0u8; (SIZE * SIZE * 4) as usize];
    let (c, r_out, r_in) = ((s as f64 - 1.0) / 2.0, 17.0, 12.0);
    for y in 0..s {
        for x in 0..s {
            let (dx, dy) = (x as f64 - c, y as f64 - c);
            let d = (dx * dx + dy * dy).sqrt();
            // Ângulo a partir do topo, no sentido horário; o arco deixa a abertura embaixo.
            let ang = dx.atan2(-dy).to_degrees();
            let arc = d <= r_out && d >= r_in && ang.abs() <= 135.0;
            // Ponteiro: do centro para cima e à direita (45°), 3 px de largura.
            let (ux, uy) = (std::f64::consts::FRAC_1_SQRT_2, -std::f64::consts::FRAC_1_SQRT_2);
            let along = dx * ux + dy * uy;
            let across = (dx * uy - dy * ux).abs();
            let needle = (0.0..=r_in - 1.0).contains(&along) && across <= 1.6;
            let hub = d <= 3.0;
            if arc || needle || hub {
                let i = ((y * s + x) * 4) as usize;
                px[i..i + 4].copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
            }
        }
    }
    px
}

/// Os dois maiores usos (em %) entre os limites que ainda valem.
pub fn top_two(lims: &[super::Limit], now: u64) -> (Option<f64>, Option<f64>) {
    let mut v: Vec<f64> = lims.iter().filter(|l| l.live(now)).map(|l| l.used_pct).collect();
    v.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));
    (v.first().copied(), v.get(1).copied())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alpha(px: &[u8], x: u32, y: u32) -> u8 {
        px[((y * SIZE + x) * 4 + 3) as usize]
    }

    #[test]
    fn barras_proporcionais() {
        let px = render(Some(50.0), None, [0, 0, 0]);
        assert_eq!(px.len(), (SIZE * SIZE * 4) as usize);
        // Barra de cima (y 7..19): metade cheia, metade trilho; a de baixo (y 25..37) só trilho.
        assert_eq!(alpha(&px, 10, 13), 255);
        assert_eq!(alpha(&px, 34, 13), 80);
        assert_eq!(alpha(&px, 10, 31), 80);
        // Fora das barras é transparente (inclusive o canto arredondado).
        assert_eq!(alpha(&px, 1, 1), 0);
        assert_eq!(alpha(&px, 4, 7), 0);
        let cheio = render(Some(100.0), Some(100.0), [255, 255, 255]);
        assert_eq!(alpha(&cheio, 38, 31), 255);
    }

    #[test]
    fn uma_ou_tres_barras() {
        // Uma barra: centralizada (y 15..29).
        let um = render_bars(&[Some(100.0)], [0, 0, 0]);
        assert_eq!((alpha(&um, 20, 22), alpha(&um, 20, 10), alpha(&um, 20, 33)), (255, 0, 0));
        // Três barras de 10 px com 4 de folga (y 3..13, 17..27, 31..41).
        let tres = render_bars(&[Some(100.0), None, Some(0.0)], [0, 0, 0]);
        assert_eq!((alpha(&tres, 20, 8), alpha(&tres, 20, 22), alpha(&tres, 20, 36), alpha(&tres, 20, 15), alpha(&tres, 20, 42)), (255, 80, 80, 0, 0));
        assert_eq!((window_title("seven_day_opus"), window_title("extra"), window_title("x")), ("Semana (Opus)".to_string(), "Uso extra".to_string(), "x".to_string()));
        // Mais de 3: só as 3 primeiras.
        assert_eq!(render_bars(&[None; 5], [0, 0, 0]), render_bars(&[None; 3], [0, 0, 0]));
        // Símbolo: arco opaco no topo, abertura embaixo, transparente nos cantos.
        let g = render_glyph([0, 0, 0]);
        assert_eq!((alpha(&g, 21, 7), alpha(&g, 21, 40), alpha(&g, 0, 0)), (255, 0, 0));
    }

    fn lim(p: &str, acc: &str, w: &str, pct: f64, resets: u64) -> Limit {
        Limit { provider: p.into(), account: Some(acc.into()), window: w.into(), title: w.into(), used_pct: pct, resets_at: Some(resets), ..Default::default() }
    }

    #[test]
    fn selecao_automatica_e_manual() {
        let lims = vec![lim("claude", "claude:sistema", "5h", 22.0, 100), lim("claude", "claude:sistema", "semana", 61.0, 100), lim("codex", "codex:sistema", "mes", 90.0, 5), lim("agy", "agy:sistema", "5h", 40.0, 100)];
        let auto = TrayIconPrefs::default();
        // Automático: os dois mais apertados que ainda valem (o Codex a 90% já reiniciou).
        let s = select(&lims, &auto, 50);
        assert_eq!(s.iter().map(|x| (x.provider.as_str(), x.window.as_str(), x.used_pct)).collect::<Vec<_>>(), vec![("claude", "semana", Some(61.0)), ("agy", "5h", Some(40.0))]);
        // Manual: na ordem escolhida, até 3; um escolhido sem leitura entra vazio.
        let pin = |p: &str, a: &str, w: &str| PinnedLimit { provider: p.into(), account: a.into(), window: w.into() };
        let manual = TrayIconPrefs { mode: "manual".into(), pinned: vec![pin("claude", "claude:sistema", "5h"), pin("codex", "codex:sistema", "mes"), pin("agy", "agy:sistema", "5h"), pin("claude", "claude:sistema", "semana")], ..Default::default() };
        let s = select(&lims, &manual, 50);
        assert_eq!(s.len(), 3);
        assert_eq!(s.iter().map(|x| x.used_pct).collect::<Vec<_>>(), vec![Some(22.0), None, Some(40.0)]);
        assert_eq!(s[1].title, "Mês");
        // Manual sem nada escolhido = automático.
        let vazio = TrayIconPrefs { mode: "manual".into(), ..Default::default() };
        assert_eq!(select(&lims, &vazio, 50), select(&lims, &auto, 50));
        // Conta sem perfil (CodexBar): casa pelo rótulo.
        let cb = Limit { provider: "copilot".into(), account: None, account_label: Some("dev@example.com".into()), window: "secondary".into(), used_pct: 5.0, resets_at: Some(100), ..Default::default() };
        assert!(matches(&cb, &pin("copilot", "dev@example.com", "secondary")));
    }

    #[test]
    fn texto_ao_lado_por_estilo() {
        let slots = vec![Slot { used_pct: Some(22.4), ..Default::default() }, Slot { used_pct: None, ..Default::default() }];
        let st = |style: &str, spend: bool| TrayIconPrefs { style: style.into(), show_spend: spend, ..Default::default() };
        assert_eq!(title_text(&slots, &st("bars_percent", false), Some("US$ 1,20")).as_deref(), Some("22% · —"));
        assert_eq!(title_text(&slots, &st("percent", true), Some("US$ 1,20")).as_deref(), Some("22% · —  US$ 1,20"));
        assert_eq!(title_text(&slots, &st("bars", false), Some("US$ 1,20")), None);
        assert_eq!(title_text(&slots, &st("icon", true), Some("$1.20")).as_deref(), Some("$1.20"));
        assert_eq!(title_text(&[], &st("percent", false), None), None);
        assert!(draws_bars(&st("bars", false)) && !draws_bars(&st("icon", false)) && !draws_bars(&st("percent", false)));
        // Sem limite nenhum, as barras mostram dois trilhos vazios (como antes).
        assert_eq!(render_for(&[], &st("bars", false), [0, 0, 0]), render(None, None, [0, 0, 0]));
    }

    #[test]
    fn dois_maiores() {
        let l = |p: f64, r: u64| super::super::Limit { used_pct: p, resets_at: Some(r), ..Default::default() };
        assert_eq!(top_two(&[l(10.0, 100), l(90.0, 100), l(99.0, 5), l(40.0, 100)], 50), (Some(90.0), Some(40.0)));
        assert_eq!(top_two(&[], 0), (None, None));
    }
}
