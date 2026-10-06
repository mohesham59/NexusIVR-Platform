import docx
import os

doc_path = 'Documentation/NexusIVR_Documentation.docx'
doc = docx.Document(doc_path)

print("1. Replacing diagram images in relationship parts...")

image_replacements = {
    'media/image8.png': 'scratch/generated_diagrams/fig_4_2_system_architecture.png',   # Figure 4.2
    'media/image9.png': 'scratch/generated_diagrams/fig_6_1_7pass_pipeline.png',          # Figure 6.1
    'media/image16.png': 'scratch/generated_diagrams/fig_11_1_erd.png',                   # Figure 11.1
    'media/image17.png': 'scratch/generated_diagrams/fig_12_1_multitenant.png',           # Figure 12.1
    'media/image24.png': 'scratch/generated_diagrams/fig_startup_containers.png'          # Container Startup
}

replaced_count = 0
for rel in doc.part.rels.values():
    if 'image' in rel.target_ref:
        target_ref = rel.target_ref
        if target_ref in image_replacements:
            new_img_path = image_replacements[target_ref]
            if os.path.exists(new_img_path):
                with open(new_img_path, 'rb') as f:
                    new_blob = f.read()
                rel.target_part._blob = new_blob
                replaced_count += 1
                print(f"  Successfully updated blob for {target_ref} -> {new_img_path} ({len(new_blob)} bytes)")

print(f"Total images updated: {replaced_count}")

# Save document test
doc.save('scratch/NexusIVR_Documentation_Updated_Test.docx')
print("Saved scratch/NexusIVR_Documentation_Updated_Test.docx")
