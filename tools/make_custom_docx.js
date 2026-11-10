// A design for the tests: tool/templates/extreme.docx with the sender's details typed into it (as a person would do in Word),
// and one placeholder split over two runs (as Word does after editing). Used by test_parse_generated.mjs and test_templates.js.
const OWN = { name: "Bouw BV", person: "K. de Bouwer", street: "Bouwweg 5", city: "3011 AA Rotterdam", phone: "0101234567", email: "info@bouwbv.example",
  iban: "NL02 RABO 0123 4567 89", btw: "NL001122334B01", kvk: "11223344" };
async function makeCustomDocx(JSZip, extremeBytes) {
  const zip = await JSZip.loadAsync(extremeBytes);
  let x = await zip.file("word/document.xml").async("string");
  const rep = [["[KVK-nummer]", OWN.kvk], ["[IBAN]", OWN.iban], ["[BTW-nummer]", OWN.btw], ["[Straat + huisnummer]", OWN.street], ["[Postcode]  [Plaats]", OWN.city],
    ["Tel: [telefoonnummer]", "Tel: " + OWN.phone], ["[e-mailadres]", OWN.email], ["[Naam]", OWN.person]];
  for (const [a, b] of rep) x = x.split(">" + a + "<").join(">" + b + "<");
  x = x.split("Extreme Building").join(OWN.name); // also in "t.n.v. Extreme Building"
  x = x.replace(">[nr]-2026</w:t>", ">[n</w:t></w:r><w:r><w:t>r]-2026</w:t>");
  zip.file("word/document.xml", x);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
module.exports = { OWN, makeCustomDocx };
