//! Ícone da barra do Kabul desenhado em RGBA, sem depender de plataforma: duas barras horizontais
//! (em cima o limite mais apertado, embaixo o segundo) com trilho translúcido. No macOS vai como
//! "template" (só o alfa conta e o sistema pinta claro/escuro); no Windows/Linux, com a cor dada.

/// Tamanho do ícone (quadrado, em pixels).
pub const SIZE: u32 = 44;

/// `top`/`bottom`: uso em % (0–100) ou `None` (sem dado: só o trilho). `rgb`: cor das barras.
pub fn render(top: Option<f64>, bottom: Option<f64>, rgb: [u8; 3]) -> Vec<u8> {
    let s = SIZE as i32;
    let mut px = vec![0u8; (SIZE * SIZE * 4) as usize];
    let (x0, x1, h, r) = (4, s - 4, 12, 6);
    let mut bar = |y0: i32, pct: Option<f64>| {
        let fill = pct.map(|p| x0 + ((x1 - x0) as f64 * p.clamp(0.0, 100.0) / 100.0).round() as i32);
        for y in y0..y0 + h {
            for x in x0..x1 {
                // Cantos arredondados: fora do raio nos quatro cantos fica transparente.
                let (cx, cy) = (
                    if x < x0 + r {
                        x0 + r
                    } else if x >= x1 - r {
                        x1 - r - 1
                    } else {
                        x
                    },
                    if y < y0 + r {
                        y0 + r
                    } else if y >= y0 + h - r {
                        y0 + h - r - 1
                    } else {
                        y
                    },
                );
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
    };
    bar(7, top);
    bar(25, bottom);
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
        // Barra de cima: metade cheia, metade trilho; a de baixo só trilho.
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
    fn dois_maiores() {
        let l = |p: f64, r: u64| super::super::Limit { used_pct: p, resets_at: Some(r), ..Default::default() };
        assert_eq!(top_two(&[l(10.0, 100), l(90.0, 100), l(99.0, 5), l(40.0, 100)], 50), (Some(90.0), Some(40.0)));
        assert_eq!(top_two(&[], 0), (None, None));
    }
}
