import subprocess

models = [
    # "ViT-B-16-SigLIP__webli",
    # "ViT-B-16-SigLIP-256__webli",
    # "ViT-B-16-SigLIP-384__webli",
    # "ViT-B-16-SigLIP-512__webli",
    # "ViT-B-16-SigLIP-i18n-256__webli",
    # "ViT-B-16-plus-240__laion400m_e31",
    # "ViT-B-16-plus-240__laion400m_e32",
    # "ViT-B-16__laion400m_e31",
    # "ViT-B-16__laion400m_e32",
    # "ViT-B-16__openai",
    # "ViT-B-32__laion2b-s34b-b79k",
    # "ViT-B-32__laion2b_e16",
    # "ViT-B-32__laion400m_e31",
    # "ViT-B-32__laion400m_e32",
    # "ViT-B-32__openai",
    # "ViT-L-14-336__openai",
    # "ViT-B-16-SigLIP2__webli",
    # "ViT-B-32-SigLIP2-256__webli",
    # "ViT-B-32-SigLIP2-384__webli", # not available yet
    # "ViT-B-32-SigLIP2-512__webli", # not available yet
    # "ViT-L-16-SigLIP2-256__webli",
    # "ViT-L-16-SigLIP2-384__webli", # rknn seems to hang
    # "ViT-L-16-SigLIP2-512__webli",
    "ViT-SO400M-14-SigLIP2__webli",
    "ViT-SO400M-14-SigLIP2-378__webli",
    "ViT-SO400M-16-SigLIP2-256__webli",
    "ViT-SO400M-16-SigLIP2-384__webli",
    "ViT-SO400M-16-SigLIP2-512__webli",
    # "ViT-gopt-16-SigLIP2-256__webli",
    # "ViT-gopt-16-SigLIP2-384__webli",
    # "ViT-L-14-quickgelu__dfn2b",
    # "ViT-L-14__laion2b-s32b-b82k",
    # "ViT-L-14__laion400m_e31",
    # "ViT-L-14__laion400m_e32",
    # "ViT-L-14__openai",
    # "ViT-L-16-SigLIP-256__webli",
    # "ViT-L-16-SigLIP-384__webli",
    # "ViT-SO400M-14-SigLIP-384__webli",
    # "ViT-H-14__laion2b-s32b-b79k",
    # "ViT-H-14-quickgelu__dfn5b",
    # "ViT-H-14-378-quickgelu__dfn5b",
    # "RN101__openai",
    # "RN101__yfcc15m",
    # "RN50__cc12m",
    # "RN50__openai",
    # "RN50__yfcc15m",
    # "RN50x16__openai",
    # "RN50x4__openai",
    # "RN50x64__openai",
    # "nllb-clip-base-siglip__mrl",
    # "nllb-clip-base-siglip__v1",
    # "nllb-clip-large-siglip__mrl",
    # "nllb-clip-large-siglip__v1",
    # "xlm-roberta-base-ViT-B-32__laion5b_s13b_b90k",
    # "xlm-roberta-large-ViT-H-14__frozen_laion5b_s13b_b90k",
    # "M-CLIP/LABSE-Vit-L-14",
    # "M-CLIP/XLM-Roberta-Large-Vit-B-16Plus",
    # "M-CLIP/XLM-Roberta-Large-Vit-B-32",
    # "M-CLIP/XLM-Roberta-Large-Vit-L-14",
]

if __name__ == "__main__":
    for model in models:
        try:
            print(f"Exporting model {model}")
            subprocess.check_call(["python", "export.py", model, "openclip"])
        except Exception as e:
            print(f"Failed to export model {model}: {e}")
