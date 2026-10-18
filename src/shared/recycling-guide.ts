import type { Material } from './domain';

/**
 * "Can I recycle this?" (the brief's local recycling guide). Each everyday
 * item has one of three answers, the material it counts as, and what to do.
 * Malay words are in the search terms so either language finds the item.
 * Collectors differ: the township's own partner list, in the app, is the last word.
 */

export type GuideVerdict = 'YES' | 'SPECIAL' | 'NO';

export interface GuideItem {
  id: string;
  name: string;
  verdict: GuideVerdict;
  /** What it counts as at a kiosk or collector. Null when no recycling stream takes it. */
  material: Material | null;
  /** How to prepare it, where it goes, or why it cannot be recycled. */
  how: string;
  /** Other words people search with, in English and Malay. */
  terms: string[];
}

export const GUIDE_VERDICT_LABELS: Record<GuideVerdict, string> = {
  YES: 'Yes, recycle it',
  SPECIAL: 'Yes, but not with the rest',
  NO: 'No, general waste',
};

export const RECYCLING_GUIDE: GuideItem[] = [
  // --- Yes ---------------------------------------------------------------------
  { id: 'pet-bottle', name: 'Plastic drink bottle', verdict: 'YES', material: 'PLASTIC_PET', how: 'Empty it, rinse it and put the cap back on.', terms: ['bottle', 'water bottle', 'mineral water', 'soft drink', 'pet', 'botol', 'botol plastik', 'botol air'] },
  { id: 'hdpe-bottle', name: 'Shampoo or detergent bottle', verdict: 'YES', material: 'PLASTIC_OTHER', how: 'Empty and rinse it. The label can stay on.', terms: ['detergent', 'shampoo', 'soap', 'hdpe', 'milk bottle', 'botol syampu', 'botol sabun', 'pencuci'] },
  { id: 'hard-container', name: 'Hard plastic food container', verdict: 'YES', material: 'PLASTIC_OTHER', how: 'Wash off all the food and let it dry. A greasy one goes in general waste.', terms: ['container', 'takeaway', 'tub', 'tupperware', 'bekas plastik', 'bekas makanan', 'tapau'] },
  { id: 'drink-can', name: 'Drink can', verdict: 'YES', material: 'ALUMINIUM', how: 'Rinse it and crush it to save space.', terms: ['can', 'soda can', 'aluminium', 'tin minuman', 'tin'] },
  { id: 'food-tin', name: 'Food tin', verdict: 'YES', material: 'ALUMINIUM', how: 'Rinse out the food. Mind the sharp lid.', terms: ['tin', 'canned food', 'sardine', 'tin sardin', 'tin makanan'] },
  { id: 'glass', name: 'Glass bottle or jar', verdict: 'YES', material: 'GLASS', how: 'Rinse it and take the lid off. Wrap anything broken.', terms: ['jar', 'sauce bottle', 'glass', 'botol kaca', 'balang', 'kaca'] },
  { id: 'cardboard', name: 'Cardboard box', verdict: 'YES', material: 'PAPER', how: 'Flatten it and keep it dry. Tape can stay on.', terms: ['box', 'carton', 'parcel box', 'shopee box', 'kotak', 'kadbod'] },
  { id: 'newspaper', name: 'Newspapers and magazines', verdict: 'YES', material: 'PAPER', how: 'Keep them dry and tie them in a bundle.', terms: ['newspaper', 'magazine', 'surat khabar', 'akhbar', 'majalah'] },
  { id: 'office-paper', name: 'Office paper and envelopes', verdict: 'YES', material: 'PAPER', how: 'Keep it dry. Tear out plastic windows if you can.', terms: ['paper', 'a4', 'envelope', 'letter', 'kertas', 'sampul surat', 'buku'] },
  { id: 'egg-tray', name: 'Paper egg tray', verdict: 'YES', material: 'PAPER', how: 'Keep it dry and free of broken egg.', terms: ['egg carton', 'egg tray', 'bekas telur', 'papan telur'] },
  { id: 'clothes', name: 'Old clothes', verdict: 'YES', material: 'TEXTILE', how: 'Clean and dry, in a tied bag. Torn clothes are fine too.', terms: ['clothes', 'shirt', 'trousers', 'baju', 'seluar', 'kain', 'pakaian'] },
  { id: 'shoes-bags', name: 'Shoes and bags', verdict: 'YES', material: 'TEXTILE', how: 'Clean and dry. Tie shoes together in pairs.', terms: ['shoes', 'sandals', 'handbag', 'kasut', 'selipar', 'beg'] },
  { id: 'linen', name: 'Towels and bedsheets', verdict: 'YES', material: 'TEXTILE', how: 'Clean and dry, in a tied bag.', terms: ['towel', 'bedsheet', 'curtain', 'tuala', 'cadar', 'langsir'] },

  // --- Yes, but separately -----------------------------------------------------
  { id: 'cooking-oil', name: 'Used cooking oil', verdict: 'SPECIAL', material: 'COOKING_OIL', how: 'Let it cool, strain it and seal it in a bottle. Bring it to a kiosk or book a collection. Never pour it down the drain or sink.', terms: ['oil', 'cooking oil', 'frying oil', 'minyak', 'minyak masak', 'minyak terpakai'] },
  { id: 'phone-laptop', name: 'Old phone or laptop', verdict: 'SPECIAL', material: 'E_WASTE', how: 'Back up and wipe your data first. Bring it to a kiosk or book an e-waste collection.', terms: ['phone', 'handphone', 'laptop', 'computer', 'tablet', 'telefon', 'komputer'] },
  { id: 'batteries', name: 'Batteries', verdict: 'SPECIAL', material: 'E_WASTE', how: 'Tape over the ends and keep them apart from other rubbish: crushed batteries can start fires.', terms: ['battery', 'power bank', 'aa', 'bateri'] },
  { id: 'small-appliance', name: 'Small appliance with a plug', verdict: 'SPECIAL', material: 'E_WASTE', how: 'Kettles, irons, fans and the like: book an e-waste collection or bring it to a kiosk.', terms: ['kettle', 'iron', 'fan', 'rice cooker', 'hair dryer', 'cerek', 'seterika', 'kipas', 'periuk nasi'] },
  { id: 'lamps', name: 'Light bulbs and tubes', verdict: 'SPECIAL', material: 'E_WASTE', how: 'Keep them whole and wrapped: fluorescent tubes contain mercury. Bring them to an e-waste point.', terms: ['bulb', 'lamp', 'fluorescent', 'led', 'mentol', 'lampu', 'tiub'] },
  { id: 'ink', name: 'Printer ink cartridges', verdict: 'SPECIAL', material: 'E_WASTE', how: 'Put them in a bag and bring them with other e-waste.', terms: ['ink', 'cartridge', 'toner', 'dakwat'] },
  { id: 'drink-carton', name: 'Drink carton', verdict: 'SPECIAL', material: null, how: 'Rinse and flatten it. Only some collectors take cartons: check the collectors list first.', terms: ['carton', 'tetra pak', 'milk carton', 'juice box', 'kotak susu', 'kotak air'] },
  { id: 'bulky', name: 'Furniture or mattress', verdict: 'SPECIAL', material: null, how: 'Too big for recycling points. Ask the township office about the local council’s bulky waste collection.', terms: ['sofa', 'mattress', 'cupboard', 'furniture', 'tilam', 'almari', 'perabot'] },
  { id: 'chemicals', name: 'Paint and chemical containers', verdict: 'SPECIAL', material: null, how: 'These are hazardous. Ask the township office where to take them; never pour them into a drain.', terms: ['paint', 'thinner', 'pesticide', 'chemical', 'cat', 'racun', 'bahan kimia'] },

  // --- No ----------------------------------------------------------------------
  { id: 'pizza-box', name: 'Greasy pizza box', verdict: 'NO', material: null, how: 'Grease spoils paper recycling. Tear off the clean lid to recycle; the rest goes in general waste.', terms: ['pizza', 'greasy box', 'kotak pizza'] },
  { id: 'styrofoam', name: 'Styrofoam food box', verdict: 'NO', material: null, how: 'Most collectors here do not take it. Put it in general waste, or bring your own container next time.', terms: ['styrofoam', 'polystyrene', 'foam', 'polisterin', 'bekas polisterin'] },
  { id: 'soft-plastic', name: 'Plastic bags and cling film', verdict: 'NO', material: null, how: 'Machines and most collectors cannot take soft plastic. Reuse bags, then put them in general waste.', terms: ['plastic bag', 'cling film', 'wrapper', 'beg plastik', 'plastik', 'pembalut'] },
  { id: 'tissue', name: 'Used tissue and napkins', verdict: 'NO', material: null, how: 'They are too dirty and the fibres too short to recycle.', terms: ['tissue', 'napkin', 'kitchen towel', 'tisu'] },
  { id: 'nappies', name: 'Disposable nappies', verdict: 'NO', material: null, how: 'Wrap them and put them in general waste.', terms: ['diaper', 'nappy', 'pampers', 'lampin', 'pad'] },
  { id: 'ceramics', name: 'Broken plates, cups and mirrors', verdict: 'NO', material: null, how: 'They are not the same as bottle glass. Wrap them well so nobody gets cut, then put them in general waste.', terms: ['plate', 'mug', 'mirror', 'ceramic', 'pinggan', 'cawan', 'cermin', 'seramik'] },
  { id: 'receipts', name: 'Shiny till receipts', verdict: 'NO', material: null, how: 'Thermal paper has chemicals that spoil recycled paper.', terms: ['receipt', 'thermal paper', 'resit'] },
  { id: 'coffee-cup', name: 'Paper coffee cup', verdict: 'NO', material: null, how: 'The plastic lining makes it hard to recycle. Bring your own cup when you can.', terms: ['coffee cup', 'paper cup', 'cawan kertas', 'cawan kopi'] },
  { id: 'food-waste', name: 'Food scraps', verdict: 'NO', material: null, how: 'Not taken at recycling points. Compost it if you can; otherwise general waste.', terms: ['food', 'leftovers', 'vegetable peel', 'sisa makanan', 'kulit buah'] },
  { id: 'medicine', name: 'Medicines', verdict: 'NO', material: null, how: 'Return unused medicine to a clinic or pharmacy that takes it back. Never flush it.', terms: ['medicine', 'pills', 'syrup', 'ubat', 'pil'] },
];

const clean = (text: string) => text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Best matches first: the name, then any search term, then part of a word. */
export function searchGuide(query: string, extraNames: (item: GuideItem) => string[] = () => []): GuideItem[] {
  const q = clean(query);
  if (!q) return [];
  const scored = RECYCLING_GUIDE.map((item) => {
    const names = [item.name, ...extraNames(item)].map(clean);
    const terms = item.terms.map(clean);
    let score = 0;
    if (names.some((n) => n === q) || terms.some((t) => t === q)) score = 100;
    else if (names.some((n) => n.startsWith(q)) || terms.some((t) => t.startsWith(q))) score = 60;
    else if (names.some((n) => n.includes(q)) || terms.some((t) => t.includes(q))) score = 40;
    else if (q.split(' ').every((w) => w.length > 2 && [...names, ...terms].some((s) => s.includes(w)))) score = 20;
    return { item, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.item);
}
