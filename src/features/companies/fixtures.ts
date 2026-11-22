import { emptyCompany, emptyContact, type Company, type Contact } from "./model";

export const exampleCompanies: Company[] = [
  { ...emptyCompany, id: "example-1", name: "PT Arunika Komponen Nusantara", city: "Bekasi", province: "Jawa Barat", industry: "Automotive", company_type: "Manufacturer", status: "QUALIFIED", source_type: "EXAMPLE", suggested_services: ["Sea freight", "Customs clearance"], website: "https://arunika.example", archived_at: null },
  { ...emptyCompany, id: "example-2", name: "PT Bumi Pangan Lestari", city: "Surabaya", province: "Jawa Timur", industry: "Food and beverage", company_type: "Exporter", status: "FOLLOW_UP_REQUIRED", source_type: "EXAMPLE", suggested_services: ["Warehousing", "Domestic trucking"], archived_at: null },
  { ...emptyCompany, id: "example-3", name: "CV Sagara Tekstil Mandiri", city: "Bandung", province: "Jawa Barat", industry: "Textiles", company_type: "Manufacturer", status: "NEW", source_type: "EXAMPLE", suggested_services: ["Air freight"], archived_at: null },
  { ...emptyCompany, id: "example-4", name: "PT Lentera Elektronik Asia", city: "Batam", province: "Kepulauan Riau", industry: "Electronics", company_type: "Importer", status: "CONTACTED", source_type: "EXAMPLE", suggested_services: ["Air freight", "Customs clearance"], archived_at: null },
];

export const exampleContacts: Contact[] = [
  { ...emptyContact, id: "example-contact-1", company_id: "example-1", name: "Dewi (example)", role: "LOGISTICS_PIC", email: "logistics@arunika.example", is_primary: true },
  { ...emptyContact, id: "example-contact-2", company_id: "example-1", name: "Rani (example)", role: "RECEPTIONIST", is_primary: true },
  { ...emptyContact, id: "example-contact-3", company_id: "example-2", name: "Adi (example)", role: "LOGISTICS_PIC", is_primary: true },
];
