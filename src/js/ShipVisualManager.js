import * as THREE from "three";
import { getShipVisualDefinition } from "./definitions/shipVisualDefinitions.js";

function normalizeSceneName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cloneLightProfiles(shipDefinition) {
  return Object.fromEntries(
    shipDefinition.vfx.lightParts.map((definition) => [
      definition.id,
      {
        id: definition.id,
        type: definition.id,
        label: definition.label,
        objectMatches: [...definition.objectMatches],
        fallbackColor: shipDefinition.materials.emissiveSurface.fallbackColor,
        ...definition.settings
      }
    ])
  );
}

function createLightProfileMatches(shipDefinition) {
  return shipDefinition.vfx.lightParts.map((definition) => ({
    id: definition.id,
    normalizedNames: definition.objectMatches.map((name) => normalizeSceneName(name))
  }));
}

function createLightControlState(lightProfiles) {
  return Object.fromEntries(
    Object.entries(lightProfiles).map(([type, profile]) => [
      type,
      {
        emissiveBloom: profile.emissiveBloomEnabled !== false,
        billboard: profile.glowSpriteEnabled !== false,
        pointLight: profile.pointLightEnabled !== false
      }
    ])
  );
}

function createEngineOutputSettings(shipDefinition, lightProfiles) {
  const outputDefinition = shipDefinition.vfx.engineOutput;
  const controlledLightType = outputDefinition.controlledLightType;
  const engineProfile = lightProfiles[controlledLightType];
  return {
    controlledLightType,
    value: outputDefinition.value,
    min: { ...outputDefinition.min },
    max: {
      emissiveIntensity: engineProfile.emissiveIntensity,
      glowSpriteOpacity: engineProfile.glowSpriteOpacity,
      pointIntensity: engineProfile.pointIntensity
    }
  };
}

function createHighlightPartStates(shipDefinition) {
  return Object.fromEntries(
    Object.entries(shipDefinition.materials.highlights).map(([partId, part]) => [
      partId,
      {
        id: part.id,
        label: part.label,
        materialName: part.materialName,
        settings: {
          color: part.defaultColor
        },
        materials: []
      }
    ])
  );
}

export class ShipVisualManager {
  constructor({
    bloomLayer = 1,
    onBloomTargetsDirty,
    registerBloomMaterialOverride,
    registerBloomOcclusionTarget,
    unregisterBloomMaterialOverride
  } = {}) {
    this.bloomLayer = bloomLayer;
    this.onBloomTargetsDirty = onBloomTargetsDirty;
    this.registerBloomMaterialOverride = registerBloomMaterialOverride;
    this.registerBloomOcclusionTarget = registerBloomOcclusionTarget;
    this.unregisterBloomMaterialOverride = unregisterBloomMaterialOverride;
    this.glowSpriteTexture = this.createGlowSpriteTexture();
    this.bloomMaskMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      fog: false,
      toneMapped: false
    });
    this.scratch = {
      box: new THREE.Box3(),
      center: new THREE.Vector3(),
      direction: new THREE.Vector3(),
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      c: new THREE.Vector3(),
      ab: new THREE.Vector3(),
      ac: new THREE.Vector3(),
      bc: new THREE.Vector3(),
      triangleCenter: new THREE.Vector3(),
      triangleNormal: new THREE.Vector3(),
      longestEdge: new THREE.Vector3(1, 0, 0),
      pointOffset: new THREE.Vector3()
    };
  }

  createShipVfxState(shipDefinition, root = null, object = null) {
    const lightProfiles = cloneLightProfiles(shipDefinition);
    const highlightParts = createHighlightPartStates(shipDefinition);
    return {
      definition: shipDefinition,
      root,
      object,
      lightProfiles,
      lightProfileMatches: createLightProfileMatches(shipDefinition),
      lightControlState: createLightControlState(lightProfiles),
      engineOutputSettings: createEngineOutputSettings(shipDefinition, lightProfiles),
      highlight: {
        activePartId: Object.keys(highlightParts)[0],
        parts: highlightParts
      },
      lightRuntimeAnchors: [],
      bloomOcclusionTargets: [],
      emissionTargets: []
    };
  }

  applyToShip({ shipId, root, object }) {
    const definition = getShipVisualDefinition(shipId);
    const shipState = this.createShipVfxState(definition, root, object);

    object.updateWorldMatrix(true, true);
    root.updateWorldMatrix(true, true);
    this.applyEmissiveSurfaces(shipState);
    this.registerBloomOcclusionTargets(shipState);
    this.collectHighlightMaterials(shipState);
    this.applyHighlightMaterialColor(shipState);
    this.applyAllLightProfileSettings(shipState);
    this.applyAllLightControlStates(shipState);
    this.onBloomTargetsDirty?.();
    return shipState;
  }

  isEmissiveSurfaceMaterial(material, shipDefinition) {
    return normalizeSceneName(material?.name).includes(
      normalizeSceneName(shipDefinition.materials.emissiveSurface.materialName)
    );
  }

  getSelectedMaterialIndices(materials, shipDefinition) {
    return materials
      .map((material, index) => (this.isEmissiveSurfaceMaterial(material, shipDefinition) ? index : -1))
      .filter((index) => index >= 0);
  }

  getLightProfile(mesh, materials, shipState) {
    const names = [
      mesh.name,
      mesh.parent?.name,
      ...materials.map((material) => material?.name)
    ].filter(Boolean);
    const normalizedNames = names.map((name) => normalizeSceneName(name));

    const match = shipState.lightProfileMatches.find((profileMatch) => {
      return profileMatch.normalizedNames.some((target) => {
        return normalizedNames.some((name) => name.includes(target) || target.includes(name));
      });
    });

    return match
      ? shipState.lightProfiles[match.id]
      : shipState.lightProfiles[shipState.definition.vfx.defaultLightType];
  }

  getProfileColor(profile) {
    return new THREE.Color(profile.color || profile.fallbackColor);
  }

  getGeometryRanges(geometry, materialIndices, materialCount) {
    const vertexCount = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    if (geometry.groups.length > 0) {
      return geometry.groups
        .filter((group) => materialIndices.includes(group.materialIndex))
        .map((group) => ({ start: group.start, count: group.count }));
    }

    if (materialCount <= 1 || materialIndices.includes(0)) {
      return [{ start: 0, count: vertexCount }];
    }

    return [];
  }

  getTriangleVertexIndex(geometry, drawIndex) {
    return geometry.index ? geometry.index.getX(drawIndex) : drawIndex;
  }

  getLightSurface(mesh, materialIndices, modelCenter) {
    const geometry = mesh.geometry;
    const position = geometry.attributes.position;
    if (!position) return null;

    const ranges = this.getGeometryRanges(
      geometry,
      materialIndices,
      Array.isArray(mesh.material) ? mesh.material.length : 1
    );
    if (ranges.length === 0) return null;

    const {
      center,
      direction,
      a,
      b,
      c,
      ab,
      ac,
      bc,
      triangleCenter,
      triangleNormal,
      longestEdge,
      pointOffset
    } = this.scratch;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const surfacePoints = [];
    center.set(0, 0, 0);
    direction.set(0, 0, 0);
    longestEdge.set(1, 0, 0);
    let totalArea = 0;
    let longestEdgeLengthSq = 0;

    ranges.forEach((range) => {
      const triangleEnd = range.start + range.count - ((range.start + range.count) % 3);
      for (let i = range.start; i < triangleEnd; i += 3) {
        a.fromBufferAttribute(position, this.getTriangleVertexIndex(geometry, i)).applyMatrix4(mesh.matrixWorld);
        b.fromBufferAttribute(position, this.getTriangleVertexIndex(geometry, i + 1)).applyMatrix4(mesh.matrixWorld);
        c.fromBufferAttribute(position, this.getTriangleVertexIndex(geometry, i + 2)).applyMatrix4(mesh.matrixWorld);

        ab.subVectors(b, a);
        ac.subVectors(c, a);
        bc.subVectors(c, b);
        [
          { edge: ab, lengthSq: ab.lengthSq() },
          { edge: ac, lengthSq: ac.lengthSq() },
          { edge: bc, lengthSq: bc.lengthSq() }
        ].forEach(({ edge, lengthSq }) => {
          if (lengthSq <= longestEdgeLengthSq) return;
          longestEdge.copy(edge);
          longestEdgeLengthSq = lengthSq;
        });

        triangleNormal.crossVectors(ab, ac);
        const areaWeight = triangleNormal.length() * 0.5;
        if (areaWeight <= 0) continue;

        surfacePoints.push(a.clone(), b.clone(), c.clone());
        triangleNormal.normalize().applyMatrix3(normalMatrix).normalize();
        triangleCenter.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        center.addScaledVector(triangleCenter, areaWeight);
        direction.addScaledVector(triangleNormal, areaWeight);
        totalArea += areaWeight;
      }
    });

    if (totalArea <= 0) return null;

    center.multiplyScalar(1 / totalArea);
    if (direction.lengthSq() < 0.000001) {
      direction.subVectors(center, modelCenter);
    }
    direction.normalize();

    const outward = center.clone().sub(modelCenter);
    if (outward.lengthSq() > 0.000001 && direction.dot(outward) < 0) {
      direction.multiplyScalar(-1);
    }

    const tangent = longestEdge.clone().addScaledVector(direction, -longestEdge.dot(direction));
    if (tangent.lengthSq() < 0.000001) {
      const tangentReference = Math.abs(direction.dot(new THREE.Vector3(0, 1, 0))) < 0.92
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(1, 0, 0);
      tangent.crossVectors(tangentReference, direction);
    }
    tangent.normalize();
    const bitangent = new THREE.Vector3().crossVectors(direction, tangent).normalize();
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;

    surfacePoints.forEach((point) => {
      pointOffset.subVectors(point, center);
      const u = pointOffset.dot(tangent);
      const v = pointOffset.dot(bitangent);
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    });

    const surfaceSize = Math.sqrt(totalArea);
    return {
      center: center.clone(),
      direction: direction.clone(),
      area: totalArea,
      width: Math.max(maxU - minU, surfaceSize * 0.35),
      height: Math.max(maxV - minV, surfaceSize * 0.35)
    };
  }

  getLightSize(surface, profile) {
    const surfaceSize = Math.sqrt(surface.area);
    const lightRange = THREE.MathUtils.clamp(
      surfaceSize * profile.lightRangeScale,
      profile.minLightRange,
      profile.maxLightRange
    );
    return { surfaceSize, lightRange };
  }

  getGlowSpriteDimensions(surface, profile) {
    const surfaceSize = Math.sqrt(surface.area);
    const minDimension = surfaceSize * 0.28;
    return {
      width: Math.max(surface.width, minDimension) * profile.glowSpriteSpreadScale,
      height: Math.max(surface.height, minDimension) * profile.glowSpriteSpreadScale
    };
  }

  createGlowSpriteTexture() {
    const size = 160;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    const radius = size * 0.5;
    const gradient = context.createRadialGradient(radius, radius, 0, radius, radius, radius);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.2)");
    gradient.addColorStop(0.18, "rgba(255, 255, 255, 0.22)");
    gradient.addColorStop(0.42, "rgba(235, 246, 255, 0.18)");
    gradient.addColorStop(0.74, "rgba(210, 230, 245, 0.08)");
    gradient.addColorStop(1, "rgba(210, 230, 245, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    return texture;
  }

  addGlowSprite(shipState, surface, profile) {
    if (profile.glowSpriteEnabled === false) return null;

    const spriteDimensions = this.getGlowSpriteDimensions(surface, profile);
    const material = new THREE.SpriteMaterial({
      map: this.glowSpriteTexture,
      color: this.getProfileColor(profile),
      transparent: true,
      opacity: profile.glowSpriteOpacity,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      fog: false,
      toneMapped: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.name = `BillboardGlow_${profile.type}`;
    sprite.scale.set(spriteDimensions.width, spriteDimensions.height, 1);
    sprite.renderOrder = 20;
    sprite.layers.enable(this.bloomLayer);
    shipState.root.add(sprite);
    return sprite;
  }

  addSurfacePointLight(shipState, profile, surfaceSize, lightRange) {
    if (profile.pointLightEnabled === false) return null;

    const sizeFactor = THREE.MathUtils.clamp(surfaceSize / 0.24, 0.55, 1.45);
    const light = new THREE.PointLight(
      this.getProfileColor(profile),
      profile.pointIntensity * sizeFactor,
      lightRange * profile.pointRangeScale,
      2
    );
    light.name = `PhysicalPointLight_${profile.type}`;
    shipState.root.add(light);
    return light;
  }

  positionLocalVfx(anchor) {
    const spriteOffset = 0.012;
    const pointOffset = THREE.MathUtils.clamp(anchor.surfaceSize * 0.14, 0.025, 0.06);

    if (anchor.glowSprite) {
      anchor.glowSprite.position.copy(anchor.localCenter).addScaledVector(anchor.localDirection, spriteOffset);
    }
    if (anchor.pointLight) {
      anchor.pointLight.position.copy(anchor.localCenter).addScaledVector(anchor.localDirection, pointOffset);
    }
  }

  addRuntimeAnchor(
    shipState,
    type,
    mesh,
    surface,
    surfaceSize,
    lightRange,
    glowSprite,
    pointLight,
    materials,
    bloomMaterial
  ) {
    const rootWorldInverse = new THREE.Matrix4().copy(shipState.root.matrixWorld).invert();
    const anchor = {
      type,
      profile: shipState.lightProfiles[type],
      mesh,
      materials,
      surface,
      surfaceSize,
      glowSprite,
      pointLight,
      bloomMaterial,
      lightRange,
      localCenter: surface.center.clone().applyMatrix4(rootWorldInverse),
      localDirection: surface.direction.clone().transformDirection(rootWorldInverse).normalize()
    };

    this.positionLocalVfx(anchor);
    shipState.lightRuntimeAnchors.push(anchor);
    return anchor;
  }

  createBloomOnlyMaterial(materials, selectedMaterialIndices) {
    const bloomMaterials = materials.map((material, index) => {
      return selectedMaterialIndices.includes(index) ? material : this.bloomMaskMaterial;
    });
    return bloomMaterials.length === 1 ? bloomMaterials[0] : bloomMaterials;
  }

  registerBloomOcclusionTargets(shipState) {
    const emissiveMeshes = new Set(shipState.lightRuntimeAnchors.map((anchor) => anchor.mesh));
    shipState.bloomOcclusionTargets.length = 0;

    shipState.object.traverse((child) => {
      if (!child.isMesh || !child.material || emissiveMeshes.has(child)) return;
      this.registerBloomOcclusionTarget?.(child);
      shipState.bloomOcclusionTargets.push(child);
    });
  }

  applyEmissiveSurfaces(shipState) {
    const affectedLights = [];
    const modelCenter = this.scratch.box.setFromObject(shipState.object).getCenter(new THREE.Vector3());

    shipState.lightRuntimeAnchors.length = 0;
    shipState.emissionTargets.length = 0;
    shipState.object.traverse((child) => {
      if (!child.isMesh || !child.material) return;

      const originalMaterials = Array.isArray(child.material) ? child.material : [child.material];
      const selectedMaterialIndices = this.getSelectedMaterialIndices(originalMaterials, shipState.definition);
      if (selectedMaterialIndices.length === 0) return;

      const profile = this.getLightProfile(child, originalMaterials, shipState);
      let meshWasAffected = false;
      const affectedMaterials = [];
      const nextMaterials = originalMaterials.map((material, index) => {
        if (!material || !selectedMaterialIndices.includes(index)) return material;

        const tunedMaterial = material.clone();
        if ("emissive" in tunedMaterial) tunedMaterial.emissive.copy(this.getProfileColor(profile));
        if ("emissiveIntensity" in tunedMaterial) tunedMaterial.emissiveIntensity = profile.emissiveIntensity;
        if ("toneMapped" in tunedMaterial) tunedMaterial.toneMapped = false;
        tunedMaterial.needsUpdate = true;

        meshWasAffected = true;
        affectedMaterials.push(tunedMaterial);
        return tunedMaterial;
      });

      if (!meshWasAffected) return;

      child.material = Array.isArray(child.material) ? nextMaterials : nextMaterials[0];
      child.layers.enable(this.bloomLayer);
      const bloomMaterial = this.createBloomOnlyMaterial(nextMaterials, selectedMaterialIndices);

      const surface = this.getLightSurface(child, selectedMaterialIndices, modelCenter);
      if (!surface) return;

      const { surfaceSize, lightRange } = this.getLightSize(surface, profile);
      const glowSprite = this.addGlowSprite(shipState, surface, profile);
      const pointLight = this.addSurfacePointLight(shipState, profile, surfaceSize, lightRange);
      this.registerBloomMaterialOverride?.(child, bloomMaterial);
      this.addRuntimeAnchor(
        shipState,
        profile.type,
        child,
        surface,
        surfaceSize,
        lightRange,
        glowSprite,
        pointLight,
        affectedMaterials,
        bloomMaterial
      );
      affectedLights.push({
        name: child.name || child.uuid,
        type: profile.type,
        surfaceArea: surface.area,
        surfaceSize,
        surfaceWidth: surface.width,
        surfaceHeight: surface.height,
        lightRange,
        glowSpriteWidth: glowSprite?.scale.x ?? 0,
        glowSpriteHeight: glowSprite?.scale.y ?? 0,
        pointRange: pointLight?.distance ?? 0,
        pointIntensity: pointLight?.intensity ?? 0
      });
    });

    shipState.emissionTargets.push(...affectedLights);
    return affectedLights;
  }

  findHighlightPartForMaterial(material, shipState) {
    const materialName = normalizeSceneName(material?.name);
    return Object.values(shipState.highlight.parts).find((part) => {
      return materialName === normalizeSceneName(part.materialName);
    });
  }

  collectHighlightMaterials(shipState) {
    const materialsByPart = Object.fromEntries(
      Object.keys(shipState.highlight.parts).map((partId) => [partId, new Map()])
    );

    shipState.object.traverse((child) => {
      if (!child.isMesh || !child.material) return;

      const materialList = Array.isArray(child.material) ? child.material : [child.material];
      materialList.forEach((material) => {
        const highlightPart = this.findHighlightPartForMaterial(material, shipState);
        if (!highlightPart) return;
        materialsByPart[highlightPart.id].set(material.uuid, material);
      });
    });

    Object.entries(materialsByPart).forEach(([partId, materials]) => {
      shipState.highlight.parts[partId].materials.length = 0;
      shipState.highlight.parts[partId].materials.push(...materials.values());
    });

    return Object.values(shipState.highlight.parts).flatMap((part) => part.materials);
  }

  getActiveHighlightPart(shipState) {
    return shipState.highlight.parts[shipState.highlight.activePartId];
  }

  applyHighlightMaterialColor(shipState) {
    const highlightPart = this.getActiveHighlightPart(shipState);
    const color = new THREE.Color(highlightPart.settings.color);

    highlightPart.materials.forEach((material) => {
      if ("color" in material) material.color.copy(color);
    });
  }

  applyLightControlState(type, shipState) {
    const state = shipState.lightControlState[type];
    if (!state) return;

    shipState.lightRuntimeAnchors
      .filter((anchor) => anchor.type === type)
      .forEach((anchor) => {
        anchor.mesh.layers[state.emissiveBloom ? "enable" : "disable"](this.bloomLayer);
        if (anchor.glowSprite) anchor.glowSprite.visible = state.billboard;
        if (anchor.pointLight) anchor.pointLight.visible = state.pointLight;
      });
    this.onBloomTargetsDirty?.();
  }

  applyAllLightControlStates(shipState) {
    Object.keys(shipState.lightControlState).forEach((type) => this.applyLightControlState(type, shipState));
  }

  applyLightProfileSettings(type, shipState) {
    const profile = shipState.lightProfiles[type];
    if (!profile) return;

    const color = this.getProfileColor(profile);
    shipState.lightRuntimeAnchors
      .filter((anchor) => anchor.type === type)
      .forEach((anchor) => {
        const { lightRange } = this.getLightSize(anchor.surface, profile);
        const spriteDimensions = this.getGlowSpriteDimensions(anchor.surface, profile);
        const pointSizeFactor = THREE.MathUtils.clamp(anchor.surfaceSize / 0.24, 0.55, 1.45);

        anchor.lightRange = lightRange;
        anchor.materials.forEach((material) => {
          if ("emissive" in material) material.emissive.copy(color);
          if ("emissiveIntensity" in material) material.emissiveIntensity = profile.emissiveIntensity;
        });

        if (anchor.glowSprite) {
          anchor.glowSprite.scale.set(spriteDimensions.width, spriteDimensions.height, 1);
          anchor.glowSprite.material.color.copy(color);
          anchor.glowSprite.material.opacity = profile.glowSpriteOpacity;
        }

        if (anchor.pointLight) {
          anchor.pointLight.color.copy(color);
          anchor.pointLight.intensity = profile.pointIntensity * pointSizeFactor;
          anchor.pointLight.distance = lightRange * profile.pointRangeScale;
        }
      });
  }

  applyAllLightProfileSettings(shipState) {
    Object.keys(shipState.lightProfiles).forEach((type) => this.applyLightProfileSettings(type, shipState));
  }

  interpolateEngineOutputValue(key, shipState) {
    const settings = shipState.engineOutputSettings;
    const t = THREE.MathUtils.clamp(settings.value / 100, 0, 1);
    return THREE.MathUtils.lerp(settings.min[key], settings.max[key], t);
  }

  applyEngineOutputSettings(shipState) {
    const controlledLightType = shipState.engineOutputSettings.controlledLightType;
    const profile = shipState.lightProfiles[controlledLightType];
    ["emissiveIntensity", "glowSpriteOpacity", "pointIntensity"].forEach((key) => {
      profile[key] = this.interpolateEngineOutputValue(key, shipState);
    });
    this.applyLightProfileSettings(controlledLightType, shipState);
  }

  disposeShipState(shipState) {
    shipState?.lightRuntimeAnchors?.forEach((anchor) => {
      this.unregisterBloomMaterialOverride?.(anchor.mesh);
      if (anchor.glowSprite) {
        anchor.glowSprite.material.dispose();
        anchor.glowSprite.parent?.remove(anchor.glowSprite);
      }
      if (anchor.pointLight) {
        anchor.pointLight.parent?.remove(anchor.pointLight);
      }
    });
    shipState?.bloomOcclusionTargets?.forEach((object) => {
      this.unregisterBloomMaterialOverride?.(object);
    });
  }

  dispose() {
    this.bloomMaskMaterial.dispose();
    this.glowSpriteTexture.dispose();
  }
}
