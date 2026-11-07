/** Sample creator posts bundled with the app (mock posts of real products). */
export interface Sample {
  id: string;
  file: string;
  label: string;
  alt: string;
}

export const SAMPLES: Sample[] = [
  { id: "spf-cvs", file: "spf-cvs.png", label: "Sunscreen, CVS", alt: "A creator post about La Roche-Posay Anthelios Clear Skin SPF 60, bought at CVS for $29.99" },
  { id: "vitc-ulta", file: "vitc-ulta.png", label: "Vitamin C serum, Ulta", alt: "A creator post about CeraVe Skin Renewing Vitamin C Serum, bought at Ulta for $28.99" },
  { id: "retinol-brand", file: "retinol-brand.png", label: "Retinol serum, brand site", alt: "A creator post about Ole Henriksen Double Rewind retinol serum for $72 on the brand's site" },
  { id: "peptide-sephora", file: "peptide-sephora.png", label: "Peptide serum, Sephora", alt: "A creator post about The Ordinary Multi-Peptide + Copper Peptides serum at Sephora for $32" },
];
