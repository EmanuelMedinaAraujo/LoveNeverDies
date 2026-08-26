import json
import os
import sys

SOURCE_JSON = r"c:\Users\emanu\Downloads\foodAttributes\nachlassgerichte.json"
TARGET_JSON = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "content", "gerichte.json")

def clean_str(val):
    if val is None:
        return None
    val = val.strip()
    return val if val else None

def main():
    if not os.path.exists(SOURCE_JSON):
        print(f"Error: Source file {SOURCE_JSON} not found.", file=sys.stderr)
        sys.exit(1)

    with open(SOURCE_JSON, "r", encoding="utf-8") as f:
        rows = json.load(f)

    courts = []
    court_to_id = {}
    plz_map = {}

    for row in rows:
        plz = str(row.get("plz", "")).strip().zfill(5)
        status = row.get("status")

        if status == "found" and row.get("court_name"):
            name = clean_str(row.get("court_name"))
            lieferanschrift = clean_str(row.get("lieferanschrift"))
            postanschrift = clean_str(row.get("postanschrift"))
            telefon = clean_str(row.get("telefon"))
            fax = clean_str(row.get("fax"))
            internet = clean_str(row.get("internet"))
            email = clean_str(row.get("email"))

            court_key = (name, lieferanschrift, postanschrift, telefon, fax, internet, email)
            if court_key not in court_to_id:
                cid = len(courts)
                court_to_id[court_key] = cid
                courts.append({
                    "id": cid,
                    "name": name,
                    "lieferanschrift": lieferanschrift,
                    "postanschrift": postanschrift,
                    "telefon": telefon,
                    "fax": fax,
                    "internet": internet,
                    "email": email,
                })
            else:
                cid = court_to_id[court_key]

            plz_map[plz] = cid
        elif status == "ambiguous":
            plz_map[plz] = -1
        else:
            plz_map[plz] = -2

    output_data = {
        "gerichte": courts,
        "plz": plz_map,
    }

    os.makedirs(os.path.dirname(TARGET_JSON), exist_ok=True)
    with open(TARGET_JSON, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=None, separators=(",", ":"))

    print(f"Generated {TARGET_JSON}")
    print(f"Total courts: {len(courts)}")
    print(f"Total mapped PLZs: {len(plz_map)}")
    print(f"File size: {os.path.getsize(TARGET_JSON)} bytes (~{os.path.getsize(TARGET_JSON) / 1024:.1f} KB)")

if __name__ == "__main__":
    main()
