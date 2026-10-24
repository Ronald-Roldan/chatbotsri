import unittest
from unittest.mock import patch

from langchain_core.documents import Document

from backend.main import (
    find_cepai_zone_evidence,
    find_numeric_evidence,
    find_zone_validity_evidence,
    format_cepai_zone_answer,
    format_numeric_answer,
    format_zone_validity_answer,
    include_article_headings,
    search_pdf_pages,
)


class FindNumericEvidenceTests(unittest.TestCase):
    def test_investment_threshold_does_not_match_adjacent_contract_term(self):
        contract_term_page = Document(
            page_content=(
                "Art. 26 De la Vigencia. El plazo de vigencia de los contratos de "
                "inversión será de hasta 15 años."
            ),
            metadata={"source": "COPCI.pdf", "page": 14},
        )
        stability_page = Document(
            page_content=(
                "Dicha estabilidad tributaria también podrá ser concedida a petición de "
                "parte, en el contrato de inversión de las sociedades de otros sectores, "
                "siempre que:\n1. El monto de la inversión sea mayor a 100 millones de "
                "dólares.\n2. Informe técnico sobre los beneficios económicos."
            ),
            metadata={"source": "COPCI.pdf", "page": 15},
        )
        question = (
            "Según el COPCI, ¿cuál es el monto mínimo de inversión para solicitar "
            "estabilidad tributaria a petición de parte?"
        )

        with patch(
            "backend.main.load_pdf_pages",
            return_value=(contract_term_page, stability_page),
        ):
            evidence = find_numeric_evidence(question)

        self.assertIsNotNone(evidence)
        document, excerpt = evidence
        self.assertEqual(document.metadata["page"], 15)
        self.assertIn("100 millones", excerpt)
        self.assertNotIn("15 años", excerpt)
        answer = format_numeric_answer(question, document, excerpt)
        self.assertIn("mayor a USD 100 millones", answer)
        self.assertIn("pág. 16", answer)

    def test_unrecognized_numeric_fact_is_not_returned_as_raw_dump(self):
        document = Document(
            page_content=(
                "Art. 50.1 Monto de inversión. Para la declaratoria de zona franca "
                "no se requerirá un monto de inversión mínima para el usuario operador."
            ),
            metadata={"source": "COPCI.pdf", "page": 23},
        )

        answer = format_numeric_answer(
            "¿Se exige un monto mínimo de inversión para una Zona Franca?",
            document,
            document.page_content,
        )

        self.assertIsNone(answer)

    def test_contract_term_question_still_finds_fifteen_years(self):
        contract_term_page = Document(
            page_content=(
                "Art. 26 De la Vigencia. El plazo de vigencia de los contratos de "
                "inversión será de hasta 15 años."
            ),
            metadata={"source": "COPCI.pdf", "page": 14},
        )
        question = "¿Cuál es el plazo de vigencia de los contratos de inversión?"

        with patch(
            "backend.main.load_pdf_pages",
            return_value=(contract_term_page,),
        ):
            evidence = find_numeric_evidence(question)

        self.assertIsNotNone(evidence)
        document, excerpt = evidence
        self.assertEqual(document.metadata["page"], 14)
        self.assertIn("15", excerpt)

    def test_free_zone_term_and_repeatable_extensions(self):
        zone_article = Document(
            page_content=(
                "Art. 46 Plazo de existencia y prórroga. La declaratoria de Zona Franca "
                "tendrá como plazo de existencia un periodo mínimo de 30 años y podrá "
                "ser prorrogado por un término igual al suscrito en el contrato, las "
                "veces que sean necesarias."
            ),
            metadata={"source": "COPCI.pdf", "page": 23},
        )
        question = (
            "Según el COPCI, ¿cuál es el plazo de existencia de una Zona Franca y "
            "cuántas veces puede prorrogarse?"
        )

        with patch(
            "backend.main.load_pdf_pages",
            return_value=(zone_article,),
        ):
            evidence = find_numeric_evidence(question)

        self.assertIsNotNone(evidence)
        document, excerpt = evidence
        answer = format_numeric_answer(question, document, excerpt)

        self.assertEqual(document.metadata["page"], 23)
        self.assertIn("mínimo de 30 años", answer)
        self.assertIn("tantas veces como sea necesario", answer)
        self.assertIn("pág. 24", answer)

    def test_latest_cepai_zone_declaration_article_beats_older_summary(self):
        older_summary = Document(
            page_content=(
                "Art. 15 Órgano competente en materia de inversiones. El CEPAI será "
                "encargado de emitir dictamen favorable de declaratoria de Zonas Francas."
            ),
            metadata={"source": "COPCI.pdf", "page": 9},
        )
        updated_article_heading = Document(
            page_content=(
                "Capítulo III Comité Estratégico de Promoción y Atracción de Inversiones "
                "(CEPAI). Art. 41. Funciones del Comité. Las atribuciones del CEPAI "
                "respecto a Zonas Francas son las siguientes:"
            ),
            metadata={"source": "COPCI.pdf", "page": 21},
        )
        updated_article_continuation = Document(
            page_content=(
                "a) Emitir dictamen favorable para la declaratoria de Zona Franca, previo "
                "a la verificación del proyecto presentado por el usuario operador por "
                "parte del Ministerio de Producción, Comercio Exterior, Inversiones y "
                "Pesca, lo cual se ejecutará mediante resolución del CEPAI. "
                "b) Calificar a los usuarios operadores de las Zonas Francas."
            ),
            metadata={"source": "COPCI.pdf", "page": 22},
        )
        question = "¿Qué función cumple el CEPAI en la declaratoria de Zonas Francas?"

        with patch(
            "backend.main.load_pdf_pages",
            return_value=(
                older_summary,
                updated_article_heading,
                updated_article_continuation,
            ),
        ):
            evidence = find_cepai_zone_evidence(question)
            ranked_pages = search_pdf_pages(question, limit=2)

        self.assertIsNotNone(evidence)
        self.assertEqual(evidence.metadata["page"], 22)
        self.assertIn(22, [document.metadata["page"] for document in ranked_pages])
        answer = format_cepai_zone_answer(evidence)
        self.assertIn("artículo 41", answer)
        self.assertIn("resolución del CEPAI", answer)
        self.assertIn("pág. 23", answer)
        self.assertIsNone(
            find_cepai_zone_evidence(
                "¿Qué funciones cumple el usuario operador en las Zonas Francas?"
            )
        )

    def test_zone_declaration_validity_question_uses_article_46_not_cepai(self):
        obsolete_cepai_excerpt = Document(
            page_content=(
                "Art. 15 Órgano competente. Emitir dictamen favorable de declaratoria "
                "de Zonas Francas, previa verificación del proyecto."
            ),
            metadata={"source": "COPCI.pdf", "page": 9},
        )
        cepai_functions = Document(
            page_content=(
                "Art. 41 Funciones del CEPAI. Emitir dictamen favorable para la "
                "declaratoria de Zona Franca mediante resolución del CEPAI."
            ),
            metadata={"source": "COPCI.pdf", "page": 22},
        )
        zone_validity = Document(
            page_content=(
                "Art. 46 Plazo de existencia y prórroga. La declaratoria de Zona "
                "Franca tendrá como plazo de existencia un periodo mínimo de 30 años "
                "y podrá ser prorrogado por un término igual al suscrito en el "
                "contrato, las veces que sean necesarias. Nota: Artículo sustituido "
                "por la Ley No. 0, publicada en Registro Oficial Suplemento 461 de "
                "20 de Diciembre del 2023."
            ),
            metadata={"source": "COPCI.pdf", "page": 23},
        )
        question = (
            "En el COPCI, ¿cuál es el plazo de vigencia de una declaratoria de Zona Franca?"
        )

        with patch(
            "backend.main.load_pdf_pages",
            return_value=(obsolete_cepai_excerpt, cepai_functions, zone_validity),
        ):
            evidence = find_zone_validity_evidence(question)
            cepai_evidence = find_cepai_zone_evidence(question)

        self.assertIsNotNone(evidence)
        self.assertEqual(evidence.metadata["page"], 23)
        self.assertIsNone(cepai_evidence)
        answer = format_zone_validity_answer(evidence)
        self.assertIn("artículo 46", answer)
        self.assertIn("mínimo de 30 años", answer)
        self.assertIn("tantas veces como sea necesario", answer)
        self.assertIn("pág. 24", answer)

    def test_retrieval_adds_article_heading_from_previous_page(self):
        heading_page = Document(
            page_content=(
                "Capítulo III Comité Estratégico de Promoción y Atracción de "
                "Inversiones (CEPAI). Art. 41 Funciones del Comité respecto a Zonas Francas."
            ),
            metadata={"source": "COPCI.pdf", "page": 21},
        )
        continuation_page = Document(
            page_content=(
                "a) Emitir dictamen favorable para la declaratoria de Zona Franca."
            ),
            metadata={"source": "COPCI.pdf", "page": 22},
        )
        question = "¿Qué función cumple el CEPAI en la declaratoria de Zonas Francas?"

        with patch(
            "backend.main.load_pdf_pages",
            return_value=(heading_page, continuation_page),
        ):
            documents = include_article_headings(question, [continuation_page])

        self.assertEqual(
            [document.metadata["page"] for document in documents],
            [21, 22],
        )


if __name__ == "__main__":
    unittest.main()
